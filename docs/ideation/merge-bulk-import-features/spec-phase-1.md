# Implementation Spec: Merge Bulk Import Features - Phase 1 (Foundation)

**Contract**: ./contract.md
**Estimated Effort**: L

## Technical Approach

This phase converts the workos-migrations repo from CommonJS/Inquirer to ESM/Commander and sets up the shared infrastructure that all subsequent phases depend on. The bulk-user-import tool uses ESM (`"type": "module"` in package.json) and Commander.js — we need to align the official repo to match before porting any features.

The key challenge is that Inquirer.js is deeply embedded in `src/cli.ts`, and the current provider abstraction pattern (select provider -> select action -> entity picker) won't map cleanly to Commander's command-based model. We'll replace the single interactive flow with a Commander program that registers subcommands, and establish the shared types, utilities, and SDK client setup that all subsequent phases will build on.

We'll also port the core shared modules from the bulk tool: types, rate limiter, progress tracking utilities, and the WorkOS SDK client wrapper. These are foundational pieces used by the import pipeline, exporters, and post-import tools.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/index.ts` | Commander program setup, registers all subcommands |
| `src/cli/commands/validate.ts` | Placeholder validate command (full implementation in Phase 5) |
| `src/cli/commands/import.ts` | Placeholder import command (full implementation in Phase 2) |
| `src/cli/commands/export-auth0.ts` | Placeholder export-auth0 command (full implementation in Phase 3) |
| `src/shared/types.ts` | Unified type definitions ported from both repos |
| `src/shared/rate-limiter.ts` | Token bucket rate limiter from bulk tool's `src/workers/distributedRateLimiter.ts` |
| `src/shared/progress.ts` | Progress bar and summary reporting utilities |
| `src/shared/workos-client.ts` | WorkOS SDK client wrapper with retry logic |
| `src/shared/csv-utils.ts` | Shared CSV parsing/writing utilities (streaming) |
| `src/shared/logger.ts` | Chalk-based logging with verbosity levels |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `package.json` | Add `"type": "module"`, switch to Commander.js, add WorkOS SDK dep, update scripts, add `"bin"` field |
| `tsconfig.json` | Change `module` to `"ESNext"`, `moduleResolution` to `"bundler"`, update target |
| `.eslintrc.json` | Update parser options for ESM |
| `jest.config.js` → `jest.config.ts` | Convert to ESM-compatible Jest config with ts-jest/esm preset |
| `src/index.ts` | New entry point that imports Commander CLI and runs it |
| `src/providers/index.ts` | Keep provider registry but adapted for ESM exports |
| `src/providers/auth0/index.ts` | Keep provider definition, adapted for ESM |
| `src/providers/clerk/index.ts` | Keep provider definition, adapted for ESM |
| `src/providers/firebase/index.ts` | Keep provider definition, adapted for ESM |
| `src/providers/cognito/index.ts` | Keep provider definition, adapted for ESM |
| `src/providers/csv/templates.ts` | Keep SSO connections template, adapted for ESM |

### Deleted Files

| File Path | Reason |
|-----------|--------|
| `src/cli.ts` | Replaced by `src/cli/index.ts` with Commander-based architecture |
| `src/providers/csv/client.ts` | Import logic moves to dedicated import command (Phase 2) |
| `src/providers/csv/workos-api.ts` | Non-functional stub for non-existent API endpoint, replaced by SDK-based approach |
| `src/providers/csv/validator.ts` | Replaced by more capable validator in Phase 5 |
| `src/providers/auth0/client.ts` | Replaced by streaming exporter in Phase 3 |
| `src/utils/config.ts` | Credential save/load functionality moves to shared module |
| `src/utils/export.ts` | JSON export utility replaced by CSV streaming |
| `src/utils/feature-request.ts` | Feature request recording no longer needed |

## Implementation Details

### Commander CLI Setup

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/bin/import-users.ts`

**Overview**: Replace the Inquirer-based interactive flow with a Commander program that registers subcommands. Each command gets its own file and handles its own argument parsing.

```typescript
// src/cli/index.ts
import { Command } from 'commander';

const program = new Command();

program
  .name('workos-migrate')
  .description('WorkOS Migration Tool - migrate users from identity providers to WorkOS')
  .version('2.0.0');

// Each command registered from its own file
// import { registerImportCommand } from './commands/import.js';
// registerImportCommand(program);

export { program };
```

**Key decisions**:
- Each command in its own file under `src/cli/commands/` for clean separation
- Commands register themselves on the program via `registerXCommand(program)` pattern
- Placeholder commands created in this phase, filled in by subsequent phases

**Implementation steps**:
1. Add Commander.js, `@workos-inc/node`, `csv-parse`, `csv-stringify`, `cli-progress`, `chalk`, `dotenv` to dependencies
2. Remove `inquirer`, `axios`, `form-data` dependencies
3. Set `"type": "module"` in package.json and add `"bin": { "workos-migrate": "./dist/index.js" }`
4. Update tsconfig.json for ESM output
5. Create Commander program in `src/cli/index.ts`
6. Create `src/index.ts` as the entry point that calls `program.parse()`
7. Register placeholder commands for all planned features

### ESM Conversion

**Overview**: Convert all existing files from CommonJS to ESM. This affects imports/exports and the build configuration.

**Key decisions**:
- Use `"module": "ESNext"` and `"moduleResolution": "bundler"` in tsconfig
- All imports must use `.js` extension (TypeScript ESM requirement)
- Jest needs `ts-jest/esm` or `vitest` — evaluate during implementation
- `chalk` v5+ is ESM-only, so this unblocks upgrading

**Implementation steps**:
1. Update `tsconfig.json`: set `module` to `"ESNext"`, `moduleResolution` to `"bundler"`, `target` to `"ES2022"`
2. Add `.js` extensions to all relative imports across all files
3. Replace `module.exports` with `export` statements
4. Replace `require()` with `import` statements
5. Update `jest.config.js` → `jest.config.ts` for ESM compatibility
6. Verify `npm run build` produces valid ESM output

### Shared Types

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/types.ts`

**Overview**: Create a unified type system that covers both the existing provider abstraction and the bulk tool's import/export types.

```typescript
// src/shared/types.ts
export interface UserRecord {
  email: string;
  firstName?: string;
  lastName?: string;
  emailVerified?: boolean;
  externalId?: string;
  passwordHash?: string;
  passwordHashType?: 'bcrypt' | 'firebase-scrypt' | 'auth0' | 'md5' | 'okta-bcrypt';
  password?: string;
  metadata?: Record<string, string>;
  orgId?: string;
  orgExternalId?: string;
  orgName?: string;
  roleSlugs?: string[];
}

export interface ImportOptions {
  csvFilePath: string;
  concurrency?: number;
  rateLimit?: number;
  workers?: number;
  chunkSize?: number;
  jobId?: string;
  resume?: boolean;
  dryRun?: boolean;
  createOrgIfMissing?: boolean;
  orgId?: string;
  orgExternalId?: string;
  orgName?: string;
  dedupe?: boolean;
  quiet?: boolean;
}

export interface ImportSummary {
  totalRows: number;
  usersCreated: number;
  membershipsCreated: number;
  duplicateUsers: number;
  duplicateMemberships: number;
  errors: number;
  duration: number;
}

export interface ErrorRecord {
  recordNumber: number;
  email?: string;
  userId?: string;
  errorType: 'user_create' | 'membership_create' | 'org_resolution' | 'role_assignment';
  errorMessage: string;
  timestamp: string;
  httpStatus?: number;
  workosCode?: string;
  workosRequestId?: string;
}
```

**Implementation steps**:
1. Create `src/shared/types.ts` with unified types from both repos
2. Create `src/shared/rate-limiter.ts` ported from bulk tool's distributed rate limiter
3. Create `src/shared/progress.ts` with progress bar and summary formatting utilities
4. Create `src/shared/workos-client.ts` wrapping the WorkOS Node SDK with retry logic
5. Create `src/shared/csv-utils.ts` for streaming CSV read/write operations
6. Create `src/shared/logger.ts` for consistent console output formatting

### Package.json Updates

**Overview**: Major dependency changes and script updates.

```json
{
  "type": "module",
  "bin": {
    "workos-migrate": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "node --experimental-vm-modules node_modules/.bin/jest",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "typecheck": "tsc --noEmit"
  }
}
```

**Dependencies to add**: `commander`, `@workos-inc/node`, `csv-parse`, `csv-stringify`, `cli-progress`, `dotenv`, `prompts`

**Dependencies to remove**: `inquirer`, `@types/inquirer`, `axios`, `form-data`, `@types/form-data`

**Implementation steps**:
1. Update package.json with new deps, scripts, type field, and bin field
2. Run `npm install`
3. Verify build and type checking pass
4. Verify existing provider definitions still compile

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|---------|
| `src/shared/__tests__/rate-limiter.test.ts` | Token bucket rate limiter behavior |
| `src/shared/__tests__/csv-utils.test.ts` | CSV streaming read/write |
| `src/providers/csv/__tests__/templates.test.ts` | Existing template tests (adapted for ESM) |

**Key test cases**:
- Rate limiter respects configured tokens/sec
- Rate limiter handles burst correctly
- CSV utils handle BOM, Windows line endings, empty fields
- ESM imports resolve correctly across all modules
- Commander program registers all placeholder commands

## Validation Commands

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Build
npm run build

# Tests
npm test

# Verify CLI runs
node dist/index.js --help
```

## Open Items

- [ ] Decide between Jest with ESM experimental support vs. switching to Vitest (Vitest has native ESM)
- [ ] Determine if `tsx` should be a dev dependency for `npm run dev`

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
