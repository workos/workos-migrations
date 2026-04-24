# Implementation Spec: Merge Bulk Import Features - Phase 2 (Import Pipeline)

**Contract**: ./contract.md
**Depends on**: Phase 1 (Foundation)
**Estimated Effort**: XL

## Technical Approach

This is the largest and most critical phase. We port the entire import pipeline from `workos-bulk-user-import-tool-multi-org`, which includes: the core importer that calls WorkOS SDK APIs (createUser, createOrganizationMembership), the multi-threaded worker architecture using Node.js Worker Threads with a distributed rate limiter, the checkpoint/resume system for interrupted imports, the organization cache with pre-warming and thread-safe locking, and the progress tracking/summary reporting.

The bulk tool's import architecture has four "phases" internally:
1. **Single-threaded streaming** — basic sequential import
2. **Concurrent** — configurable concurrency with rate limiting
3. **Chunked** — divides CSV into chunks (1000 rows default) for checkpoint granularity
4. **Workers** — multi-threaded via Worker Threads with distributed rate limiting

We port all four modes, letting the user control which via `--workers` and `--chunk-size` flags. The import command becomes the `import` subcommand of the Commander CLI.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/commands/import.ts` | Commander import subcommand with all flags |
| `src/import/importer.ts` | Core import logic: iterate CSV rows, create users, create memberships |
| `src/import/org-cache.ts` | Organization resolution cache with pre-warming |
| `src/import/checkpoint.ts` | Checkpoint/resume state management |
| `src/import/error-writer.ts` | JSONL error streaming writer |
| `src/import/summary.ts` | Import summary calculation and display |
| `src/workers/coordinator.ts` | Worker thread coordinator — spawns workers, distributes chunks |
| `src/workers/worker.ts` | Worker thread entry point — processes assigned chunks |
| `src/workers/distributed-rate-limiter.ts` | Cross-worker rate limiting via SharedArrayBuffer |
| `src/workers/__tests__/worker.test.ts` | Worker isolation tests |
| `src/workers/__tests__/coordinator.test.ts` | Coordinator integration tests |
| `src/workers/__tests__/distributed-rate-limiter.test.ts` | Rate limiter unit tests |
| `src/workers/__tests__/fixtures/test-simple.csv` | Simple test CSV fixture |
| `src/workers/__tests__/fixtures/test-chunk.csv` | Multi-chunk test CSV fixture |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `src/cli/index.ts` | Register the import command |
| `src/shared/types.ts` | Add worker message types, chunk types, checkpoint types |
| `package.json` | No new deps needed (WorkOS SDK and csv-parse already added in Phase 1) |

## Implementation Details

### Import Command

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/bin/import-users.ts`

**Overview**: Commander subcommand that accepts all import configuration via CLI flags and orchestrates the import.

```typescript
// src/cli/commands/import.ts
export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import users from CSV into WorkOS')
    .requiredOption('--csv <path>', 'Path to CSV file')
    .option('--concurrency <n>', 'Concurrent API requests', '10')
    .option('--rate-limit <n>', 'Max requests per second', '50')
    .option('--workers <n>', 'Number of worker threads', '1')
    .option('--chunk-size <n>', 'Rows per chunk', '1000')
    .option('--job-id <id>', 'Job ID for checkpoint/resume')
    .option('--resume [jobId]', 'Resume from checkpoint')
    .option('--dry-run', 'Validate and plan without importing')
    .option('--plan', 'Show import plan without executing')
    .option('--org-id <id>', 'WorkOS organization ID for single-org mode')
    .option('--org-external-id <id>', 'External org ID for single-org mode')
    .option('--create-org-if-missing', 'Auto-create orgs not found in WorkOS')
    .option('--dedupe', 'Deduplicate rows by email')
    .option('--errors <path>', 'Error output file path', 'errors.jsonl')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => { /* orchestrate import */ });
}
```

**Key decisions**:
- `WORKOS_SECRET_KEY` env var required (not a CLI flag for security)
- Default to single-threaded concurrent mode unless `--workers > 1`
- `--dry-run` validates CSV and displays plan without calling any APIs
- `--plan` shows what would happen (user counts, org counts) without importing

**Implementation steps**:
1. Create the command with all option definitions
2. Parse and validate options in the action handler
3. Initialize WorkOS SDK client from env var
4. Determine import mode (user-only, single-org, multi-org) from CSV headers and flags
5. If `--workers > 1`, delegate to coordinator; otherwise run single-threaded importer
6. Display summary on completion

### Core Importer

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/importer.ts`

**Overview**: Streams CSV rows, creates users via WorkOS SDK, creates org memberships if applicable, handles errors with retries.

```typescript
// src/import/importer.ts
export interface ImporterOptions {
  workosClient: WorkOS;
  csvFilePath: string;
  concurrency: number;
  rateLimit: number;
  dryRun: boolean;
  orgId?: string;
  orgExternalId?: string;
  createOrgIfMissing: boolean;
  dedupe: boolean;
  errorWriter: ErrorWriter;
  orgCache: OrgCache;
  onProgress: (stats: ProgressStats) => void;
}

export async function runImport(options: ImporterOptions): Promise<ImportSummary> {
  // Stream CSV -> for each row:
  //   1. Parse row into UserRecord
  //   2. Check dedup (skip if seen)
  //   3. Create user via SDK (with retry on 429)
  //   4. If org data: resolve org (cache lookup, create if missing)
  //   5. Create membership (with role if specified)
  //   6. Track stats, write errors
}
```

**Key decisions**:
- Use `csv-parse` streaming parser (not sync) for constant memory
- Concurrency via a semaphore/pool pattern (p-limit style, ported from bulk tool)
- Retry on 429 with exponential backoff (500ms -> 1s -> 2s, 3 attempts)
- Respect `Retry-After` header from WorkOS API
- Duplicate users (409 from API) counted as `duplicateUsers`, not errors
- Membership conflicts counted as `duplicateMemberships`, not errors

**Implementation steps**:
1. Create streaming CSV parser with row-by-row processing
2. Implement user creation with WorkOS SDK (`workos.userManagement.createUser()`)
3. Implement org membership creation (`workos.userManagement.createOrganizationMembership()`)
4. Add retry logic with exponential backoff for rate limits
5. Add concurrency control (semaphore pattern)
6. Wire up progress callback and error writer
7. Return aggregated ImportSummary

### Organization Cache

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/cache/orgCache.ts`

**Overview**: In-memory cache mapping external org IDs to WorkOS org IDs. Supports pre-warming and thread-safe access.

```typescript
// src/import/org-cache.ts
export class OrgCache {
  private cache = new Map<string, string>();
  private hitCount = 0;
  private missCount = 0;

  async resolve(orgExternalId: string, workos: WorkOS, createIfMissing: boolean): Promise<string> {
    if (this.cache.has(orgExternalId)) {
      this.hitCount++;
      return this.cache.get(orgExternalId)!;
    }
    this.missCount++;
    // Look up via WorkOS API, optionally create
    // Cache the result
  }

  serialize(): Record<string, string> { /* for checkpoint */ }
  restore(data: Record<string, string>): void { /* from checkpoint */ }
}
```

**Implementation steps**:
1. Implement cache with Map<string, string>
2. Add WorkOS API lookup on cache miss
3. Add auto-create logic when `createIfMissing` is true
4. Add serialize/restore for checkpoint support
5. Track hit/miss statistics for summary reporting

### Checkpoint/Resume

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/checkpoint/`

**Overview**: Saves import state to `.workos-checkpoints/<job-id>/` directory, enabling resume after interruption.

```typescript
// src/import/checkpoint.ts
export interface CheckpointState {
  jobId: string;
  csvHash: string;
  totalRows: number;
  processedRows: number;
  chunkStates: Record<string, 'pending' | 'processing' | 'complete'>;
  orgCache: Record<string, string>;
  summary: Partial<ImportSummary>;
  timestamp: string;
}
```

**Implementation steps**:
1. Create checkpoint directory structure
2. Hash CSV file for change detection on resume
3. Save state after each chunk completes
4. On resume: load state, warn if CSV changed, skip completed chunks
5. Restore org cache from checkpoint

### Worker Architecture

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/workers/`

**Overview**: Multi-threaded import using Node.js Worker Threads. Coordinator divides CSV into chunks, spawns workers, and collects results. Workers share a rate limiter via SharedArrayBuffer.

**Key decisions**:
- Workers communicate via `parentPort.postMessage()` / `worker.on('message')`
- Rate limiter uses SharedArrayBuffer for lock-free cross-thread coordination
- Each worker gets its own WorkOS SDK client instance
- Org cache pre-warmed in main thread, serialized to workers

**Implementation steps**:
1. Port the distributed rate limiter (SharedArrayBuffer + Atomics)
2. Create worker entry point that receives chunk assignment and processes it
3. Create coordinator that splits CSV, spawns workers, merges results
4. Add progress aggregation across workers
5. Add graceful shutdown on SIGINT

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|---------|
| `src/workers/__tests__/distributed-rate-limiter.test.ts` | Rate limiter token bucket behavior |
| `src/workers/__tests__/worker.test.ts` | Worker isolation and message handling |
| `src/workers/__tests__/coordinator.test.ts` | Coordinator spawning and result merging |
| `src/import/__tests__/org-cache.test.ts` | Cache hit/miss, serialize/restore |
| `src/import/__tests__/checkpoint.test.ts` | State save/load, CSV change detection |

**Key test cases**:
- Single-threaded import with mock WorkOS client (create user, create membership)
- Multi-worker import distributes chunks correctly
- Rate limiter prevents exceeding configured limit
- Checkpoint saves and restores state correctly
- Resume skips already-processed chunks
- Dry-run mode doesn't call any APIs
- Duplicate user handling (409 response)
- Rate limit retry (429 response with backoff)

### Integration Tests

**Key scenarios**:
- E2E single worker with test CSV and dry-run
- E2E multiple workers with test CSV and dry-run
- Resume from interrupted checkpoint

## Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| Rate limit (429) | Retry 3x with exponential backoff, respect Retry-After header |
| User already exists (409) | Count as `duplicateUsers`, continue, attempt membership creation |
| Org not found | Error if not `--create-org-if-missing`, else create org |
| Membership already exists | Count as `duplicateMemberships`, continue |
| Network timeout | Retry once, then write to error JSONL |
| Invalid CSV row | Write to error JSONL, continue with next row |
| Worker crash | Coordinator marks chunk as failed, reports in summary |

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run build
npm test

# E2E dry-run test
node dist/index.js import --csv test-fixtures/simple.csv --dry-run

# E2E multi-worker dry-run
node dist/index.js import --csv test-fixtures/simple.csv --dry-run --workers 2
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
