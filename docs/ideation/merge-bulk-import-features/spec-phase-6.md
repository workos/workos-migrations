# Implementation Spec: Merge Bulk Import Features - Phase 6 (Post-Import: TOTP + Roles)

**Contract**: ./contract.md
**Depends on**: Phase 1 (Foundation), Phase 2 (Import Pipeline — for shared WorkOS client setup)
**Can run in parallel with**: Phase 5
**Estimated Effort**: M

## Technical Approach

Port two post-import tools: TOTP MFA factor enrollment and role definition/assignment processing. These run after users have been imported into WorkOS.

The TOTP enroller reads a file containing user emails and TOTP secrets (from Auth0 MFA enrollments, Firebase custom claims, or manual extraction), looks up each user in WorkOS by email, and enrolls the TOTP factor via the WorkOS SDK. This allows users to keep their existing authenticator app setup after migration.

The role processor reads role definition files, creates roles in WorkOS via the API, and assigns permissions. It also supports a user-role mapping CSV for bulk role assignment to organization memberships.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/commands/enroll-totp.ts` | Commander subcommand for TOTP enrollment |
| `src/cli/commands/process-roles.ts` | Commander subcommand for role processing |
| `src/totp/enroller.ts` | TOTP enrollment engine |
| `src/totp/parsers.ts` | CSV and NDJSON input parsers for TOTP secrets |
| `src/roles/processor.ts` | Role definition creation and assignment engine |
| `src/roles/api-client.ts` | WorkOS Roles API client wrapper |
| `src/totp/__tests__/enroller.test.ts` | TOTP enroller tests |
| `src/totp/__tests__/parsers.test.ts` | Input parser tests |
| `src/roles/__tests__/processor.test.ts` | Role processor tests |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `src/cli/index.ts` | Register enroll-totp and process-roles commands |
| `src/shared/types.ts` | Add TOTP and role types |

## Implementation Details

### TOTP Enrollment Command

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/totp/totpEnroller.ts` and `~/Documents/workos-bulk-user-import-tool-multi-org/bin/enroll-totp.ts`

```typescript
// src/cli/commands/enroll-totp.ts
export function registerEnrollTotpCommand(program: Command): void {
  program
    .command('enroll-totp')
    .description('Enroll TOTP MFA factors for imported users')
    .requiredOption('--input <path>', 'CSV or NDJSON file with email and TOTP secrets')
    .option('--concurrency <n>', 'Concurrent API requests', '5')
    .option('--rate-limit <n>', 'Max requests per second', '10')
    .option('--errors <path>', 'Error output file', 'totp-errors.jsonl')
    .option('--dry-run', 'Validate input without enrolling')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => { /* enroll */ });
}
```

### TOTP Enroller

**Overview**: For each record in the input file, look up the user in WorkOS by email, then call `enrollAuthFactor()` with the TOTP secret.

```typescript
// src/totp/enroller.ts
export interface TotpRecord {
  email: string;
  totpSecret: string;  // Base32-encoded
  totpIssuer?: string;
  totpUser?: string;
}

export async function enrollTotp(
  records: AsyncIterable<TotpRecord>,
  workos: WorkOS,
  options: { concurrency: number; rateLimit: number; dryRun: boolean; errorWriter: ErrorWriter }
): Promise<TotpSummary> {
  // For each record:
  // 1. Look up user by email via WorkOS SDK
  // 2. If not found, log error and continue
  // 3. Call workos.mfa.enrollFactor({ type: 'totp', totpSecret, totpIssuer, totpUser })
  // 4. Track success/failure/already-enrolled
}
```

**Key decisions**:
- Lower default concurrency (5) and rate limit (10/s) since TOTP enrollment is typically smaller volume
- Already-enrolled users are skipped (idempotent), not counted as errors
- User not found errors logged but don't stop the process

**Implementation steps**:
1. Create TOTP record parsers for CSV and NDJSON formats
2. Implement user lookup by email via WorkOS SDK
3. Implement factor enrollment via WorkOS SDK
4. Add concurrency control and rate limiting (reuse shared rate limiter)
5. Track and display summary statistics

### TOTP Input Parsers

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/totp/totpParsers.ts`

**CSV format**: `email,totp_secret,totp_issuer,totp_user`

**NDJSON format** (flexible):
```json
{"email": "user@example.com", "totp_secret": "BASE32SECRET"}
{"email": "user2@example.com", "secret": "BASE32SECRET", "mfa_factors": [{"type": "totp", "secret": "BASE32SECRET"}]}
```

The NDJSON parser handles multiple schema variations:
- Direct `totp_secret` or `secret` field
- `mfa_factors` array with `type: "totp"` entries
- Auth0's MFA enrollment format

**Implementation steps**:
1. Auto-detect format from file extension (.csv vs .ndjson/.jsonl)
2. CSV parser: stream rows, map to TotpRecord
3. NDJSON parser: stream lines, handle schema variations
4. Both return AsyncIterable<TotpRecord>

### Role Processing Command

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/roles/`

```typescript
// src/cli/commands/process-roles.ts
export function registerProcessRolesCommand(program: Command): void {
  program
    .command('process-role-definitions')
    .description('Create roles and assign permissions in WorkOS')
    .requiredOption('--definitions <path>', 'Role definitions CSV')
    .option('--user-mapping <path>', 'User-role mapping CSV for bulk assignment')
    .option('--org-id <id>', 'Target organization ID')
    .option('--dry-run', 'Show what would be created without making changes')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => { /* process */ });
}
```

### Role Processor

**Overview**: Reads role definition CSV, creates roles in WorkOS, and optionally assigns roles to user memberships.

**Role definitions CSV format**: `role_slug,role_name,permissions`
- `permissions` is a comma-separated list of permission slugs

**User-role mapping CSV format**: `email,role_slug` or `user_id,role_slug`

```typescript
// src/roles/processor.ts
export async function processRoleDefinitions(
  definitionsPath: string,
  workos: WorkOS,
  options: { orgId?: string; dryRun: boolean }
): Promise<RoleProcessingSummary> {
  // 1. Parse role definitions CSV
  // 2. For each role: create via WorkOS API (or update if exists)
  // 3. For each role: assign permissions
}

export async function assignRolesToUsers(
  mappingPath: string,
  workos: WorkOS,
  options: { orgId: string; dryRun: boolean }
): Promise<RoleAssignmentSummary> {
  // 1. Parse user-role mapping CSV
  // 2. For each entry: look up user, look up membership, assign role
}
```

**Key decisions**:
- Role creation is idempotent (skip if exists by slug)
- Permission assignment is additive (doesn't remove existing permissions)
- User-role mapping requires org_id since roles are scoped to org memberships
- Multiple roles per user supported (via multiple rows in mapping CSV, or `roleSlugs` array fallback)

**Implementation steps**:
1. Port role definition CSV parser
2. Implement role creation via WorkOS API
3. Implement permission assignment via WorkOS API
4. Implement user-role mapping CSV parser
5. Implement bulk role assignment to memberships
6. Add multi-role fallback (if org doesn't support multiple roles, assign first only with warning)

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|---------|
| `src/totp/__tests__/enroller.test.ts` | Enrollment with mock WorkOS client |
| `src/totp/__tests__/parsers.test.ts` | CSV and NDJSON parsing, schema variations |
| `src/roles/__tests__/processor.test.ts` | Role creation, permission assignment, user mapping |

**Key test cases**:
- TOTP enroller handles user-not-found gracefully
- TOTP enroller skips already-enrolled users
- TOTP CSV parser maps columns correctly
- TOTP NDJSON parser handles Auth0 MFA format, direct secret format
- Role processor creates roles idempotently
- Role assignment handles multi-role and single-role fallback
- Dry-run mode for both TOTP and roles doesn't call APIs

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run build
npm test

# Manual tests
node dist/index.js enroll-totp --help
node dist/index.js process-role-definitions --help
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
