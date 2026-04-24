# Implementation Spec: Merge Bulk Import Features - Phase 3 (Auth0 Export + Password Merge)

**Contract**: ./contract.md
**Depends on**: Phase 1 (Foundation)
**Can run in parallel with**: Phase 2, Phase 4
**Estimated Effort**: L

## Technical Approach

Replace the basic Auth0 export (which fetches up to 100 records as JSON) with the bulk tool's streaming CSV exporter. This exporter supports parallel user fetching, configurable rate limiting by Auth0 plan tier, checkpoint/resume for large exports, organization membership resolution (via both the Organizations API and metadata-based fallback), and streaming CSV output that keeps memory constant regardless of dataset size.

Additionally, port the `merge-passwords` command which takes an Auth0 password hash NDJSON file (obtained from Auth0 support) and merges it into the exported CSV by matching on email. This is critical because Auth0 doesn't expose password hashes through its Management API.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/commands/export-auth0.ts` | Commander subcommand for Auth0 export |
| `src/cli/commands/merge-passwords.ts` | Commander subcommand for password hash merging |
| `src/exporters/auth0/exporter.ts` | Streaming Auth0 export engine |
| `src/exporters/auth0/rate-limiter.ts` | Auth0-specific rate limiting with plan tier support |
| `src/exporters/auth0/org-resolver.ts` | Org membership resolution (API + metadata fallback) |
| `src/exporters/auth0/password-merger.ts` | Password hash NDJSON → CSV merging |
| `src/exporters/auth0/__tests__/exporter.test.ts` | Export engine tests |
| `src/exporters/auth0/__tests__/password-merger.test.ts` | Password merger tests |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `src/cli/index.ts` | Register export-auth0 and merge-passwords commands |
| `src/shared/types.ts` | Add Auth0-specific types (Auth0User, Auth0Org, ExportOptions) |
| `src/providers/auth0/index.ts` | Keep provider definition, remove old client reference |

### Deleted Files

| File Path | Reason |
|-----------|--------|
| `src/providers/auth0/client.ts` | Replaced by `src/exporters/auth0/exporter.ts` |

## Implementation Details

### Export Auth0 Command

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/exporters/auth0ExportCommand.ts`

```typescript
// src/cli/commands/export-auth0.ts
export function registerExportAuth0Command(program: Command): void {
  program
    .command('export-auth0')
    .description('Export users from Auth0 to WorkOS-compatible CSV')
    .requiredOption('--domain <domain>', 'Auth0 tenant domain')
    .requiredOption('--client-id <id>', 'M2M application Client ID')
    .requiredOption('--client-secret <secret>', 'M2M application Client Secret')
    .requiredOption('--output <path>', 'Output CSV file path')
    .option('--orgs <ids...>', 'Filter to specific Auth0 org IDs')
    .option('--page-size <n>', 'API pagination size (max 100)', '100')
    .option('--rate-limit <n>', 'API requests per second', '50')
    .option('--user-fetch-concurrency <n>', 'Parallel user fetch count', '10')
    .option('--use-metadata', 'Use user_metadata for org discovery instead of Organizations API')
    .option('--metadata-org-id-field <field>', 'Custom metadata field for org ID')
    .option('--metadata-org-name-field <field>', 'Custom metadata field for org name')
    .option('--job-id <id>', 'Job ID for export checkpointing')
    .option('--resume [jobId]', 'Resume from export checkpoint')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => { /* orchestrate export */ });
}
```

**Key decisions**:
- Auth0 credentials via CLI flags (not env vars, since these are tenant-specific)
- Output is always CSV (not JSON) — this is a breaking change from the old behavior
- Rate limit defaults to 50 req/s (Auth0 Developer plan default)
- Parallel user fetching via configurable concurrency (default 10)

**Implementation steps**:
1. Parse CLI options and validate required fields
2. Authenticate with Auth0 M2M token
3. Fetch organizations (or use metadata-based discovery)
4. For each org, fetch members with parallel user detail fetching
5. Stream results to CSV file as they arrive
6. Display progress and summary

### Streaming Export Engine

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/exporters/auth0Exporter.ts`

**Overview**: The core export engine that authenticates with Auth0, paginated-fetches users, resolves org memberships, and streams CSV output.

```typescript
// src/exporters/auth0/exporter.ts
export interface Auth0ExportOptions {
  domain: string;
  clientId: string;
  clientSecret: string;
  output: string;
  orgs?: string[];
  pageSize: number;
  rateLimit: number;
  userFetchConcurrency: number;
  useMetadata: boolean;
  metadataOrgIdField?: string;
  metadataOrgNameField?: string;
  jobId?: string;
  resume?: boolean;
  quiet: boolean;
}

export async function exportAuth0(options: Auth0ExportOptions): Promise<ExportSummary> {
  // 1. Authenticate with Auth0
  // 2. Fetch orgs (or metadata-based discovery)
  // 3. For each org, paginate through members
  // 4. For each member, fetch user details (parallel, rate-limited)
  // 5. Map to CSV row and write to output stream
  // 6. Checkpoint after each org completes
}
```

**CSV output columns**: `email`, `first_name`, `last_name`, `email_verified`, `external_id`, `org_external_id`, `org_name`, `metadata`

**Implementation steps**:
1. Port Auth0 authentication (client_credentials grant)
2. Port organization listing with pagination
3. Port user fetching with parallel detail resolution
4. Port rate limiting with Auth0-specific handling (Retry-After header)
5. Port CSV streaming output using `csv-stringify`
6. Port checkpoint/resume for large exports
7. Port skipped-users log

### Password Merger

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/exporters/mergeAuth0Passwords.ts`

**Overview**: Reads an Auth0 password hash NDJSON file, matches users by email, and adds `password_hash` and `password_hash_type` columns to the CSV.

```typescript
// src/cli/commands/merge-passwords.ts
export function registerMergePasswordsCommand(program: Command): void {
  program
    .command('merge-passwords')
    .description('Merge Auth0 password hashes into export CSV')
    .requiredOption('--csv <path>', 'Input CSV file path')
    .requiredOption('--passwords <path>', 'Password hash NDJSON file')
    .requiredOption('--output <path>', 'Output CSV file path')
    .action(async (opts) => { /* merge */ });
}
```

**Implementation steps**:
1. Parse NDJSON file into email → {hash, algorithm} map
2. Stream input CSV, for each row look up password by email (case-insensitive)
3. Add `password_hash` and `password_hash_type` columns
4. Auto-detect algorithm (bcrypt, md5, auth0)
5. Write merged CSV to output path
6. Report match statistics

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|---------|
| `src/exporters/auth0/__tests__/exporter.test.ts` | Auth0 export with mocked API responses |
| `src/exporters/auth0/__tests__/password-merger.test.ts` | NDJSON parsing, email matching, CSV merging |

**Key test cases**:
- Export with orgs filter produces correct CSV subset
- Metadata-based org discovery when Organizations API not available
- Rate limiter respects configured tokens/sec for Auth0
- Password merger matches emails case-insensitively
- Password merger auto-detects bcrypt, md5 algorithms
- Export checkpoint saves after each org, resume skips completed orgs
- Streaming output keeps memory constant

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run build
npm test

# Manual test: export-auth0 --help shows all flags
node dist/index.js export-auth0 --help

# Manual test: merge-passwords --help
node dist/index.js merge-passwords --help
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
