# Implementation Spec: Merge Bulk Import Features - Phase 4 (Clerk + Firebase Transformers)

**Contract**: ./contract.md
**Depends on**: Phase 1 (Foundation)
**Can run in parallel with**: Phase 2, Phase 3
**Estimated Effort**: M

## Technical Approach

Port the Clerk CSV transformer and Firebase JSON transformer from the bulk tool. These transform provider-specific export formats into the WorkOS-compatible CSV format that the import command (Phase 2) consumes. Both transformers support organization mapping via a separate mapping CSV and role mapping via a role mapping CSV.

The Clerk transformer takes Clerk's CSV export format and remaps columns. The Firebase transformer is more complex — it parses Firebase Auth's JSON export, handles display name splitting, extracts scrypt password hashes with PHC encoding, and maps custom claims to metadata.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/commands/transform-clerk.ts` | Commander subcommand for Clerk transformation |
| `src/cli/commands/transform-firebase.ts` | Commander subcommand for Firebase transformation |
| `src/transformers/clerk/transformer.ts` | Clerk CSV → WorkOS CSV transformation |
| `src/transformers/firebase/transformer.ts` | Firebase JSON → WorkOS CSV transformation |
| `src/transformers/firebase/scrypt.ts` | Firebase scrypt password PHC encoding |
| `src/transformers/shared/org-mapper.ts` | Shared org mapping CSV reader |
| `src/transformers/shared/role-mapper.ts` | Shared role mapping CSV reader |
| `src/transformers/__tests__/clerk.test.ts` | Clerk transformer tests |
| `src/transformers/__tests__/firebase.test.ts` | Firebase transformer tests |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `src/cli/index.ts` | Register transform-clerk and transform-firebase commands |
| `src/shared/types.ts` | Add transformer-specific types |

## Implementation Details

### Clerk Transformer

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/transformers/clerkTransformer.ts`

**Overview**: Reads Clerk's CSV export format and produces a WorkOS-compatible CSV. Supports optional org mapping (clerk_user_id → org) and role mapping (clerk_user_id → role_slug) via separate CSV files.

```typescript
// src/cli/commands/transform-clerk.ts
export function registerTransformClerkCommand(program: Command): void {
  program
    .command('transform-clerk')
    .description('Transform Clerk export CSV to WorkOS-compatible CSV')
    .requiredOption('--input <path>', 'Clerk export CSV file')
    .requiredOption('--output <path>', 'Output WorkOS CSV file')
    .option('--org-mapping <path>', 'Org mapping CSV (clerk_user_id,org_external_id,org_name)')
    .option('--role-mapping <path>', 'Role mapping CSV (clerk_user_id,role_slug)')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => { /* transform */ });
}
```

**Clerk CSV expected columns**: `id` or `user_id`, `email_address` or `email`, `first_name`, `last_name`, `email_verified` (or mapped equivalents)

**Implementation steps**:
1. Parse Clerk CSV with auto-detection of column naming variations
2. Map Clerk columns to WorkOS columns (email, first_name, last_name, email_verified, external_id)
3. If org-mapping provided, join by clerk_user_id to add org_external_id, org_name
4. If role-mapping provided, join by clerk_user_id to add role_slugs
5. Stream write WorkOS-compatible CSV
6. Log skipped users (missing email, etc.)

### Firebase Transformer

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/transformers/firebaseTransformer.ts`

**Overview**: Reads Firebase Auth's JSON export (`firebase auth:export --format=JSON`) and produces a WorkOS-compatible CSV. Handles display name splitting, scrypt password hash encoding, custom claims to metadata, and disabled user filtering.

```typescript
// src/cli/commands/transform-firebase.ts
export function registerTransformFirebaseCommand(program: Command): void {
  program
    .command('transform-firebase')
    .description('Transform Firebase Auth JSON export to WorkOS-compatible CSV')
    .requiredOption('--input <path>', 'Firebase Auth JSON export file')
    .requiredOption('--output <path>', 'Output WorkOS CSV file')
    .option('--org-mapping <path>', 'Org mapping CSV (firebase_uid,org_external_id,org_name)')
    .option('--role-mapping <path>', 'Role mapping CSV (firebase_uid,role_slug)')
    .option('--include-disabled', 'Include disabled users (excluded by default)')
    .option('--name-split <strategy>', 'Name splitting: first-space, last-space, first-name-only', 'first-space')
    .option('--signer-key <key>', 'Firebase scrypt signer key (for password hash encoding)')
    .option('--salt-separator <sep>', 'Firebase scrypt salt separator (base64)')
    .option('--rounds <n>', 'Firebase scrypt rounds', '8')
    .option('--memory-cost <n>', 'Firebase scrypt memory cost', '14')
    .option('--skip-passwords', 'Skip password hash extraction')
    .option('--quiet', 'Suppress progress output')
    .action(async (opts) => { /* transform */ });
}
```

**Firebase JSON structure**: `{ "users": [ { "localId", "email", "displayName", "emailVerified", "passwordHash", "salt", "customAttributes", "disabled", ... } ] }`

**Implementation steps**:
1. Parse Firebase JSON export (may be large, use streaming JSON parser if needed)
2. Filter disabled users (unless `--include-disabled`)
3. Split displayName into first_name/last_name using configured strategy
4. If password hash present and not `--skip-passwords`: encode as PHC scrypt format
5. Parse customAttributes (custom claims) into metadata JSON
6. If org-mapping provided, join by firebase_uid
7. If role-mapping provided, join by firebase_uid
8. Stream write WorkOS-compatible CSV

### Firebase Scrypt Password Encoding

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/transformers/firebaseScrypt.ts`

**Overview**: Encodes Firebase's scrypt password hashes into PHC (Password Hashing Competition) format that WorkOS can validate.

```typescript
// src/transformers/firebase/scrypt.ts
export interface FirebaseScryptConfig {
  signerKey: string;     // base64
  saltSeparator: string; // base64
  rounds: number;
  memoryCost: number;
}

export function encodeFirebaseScryptPHC(
  passwordHash: string,  // base64 from Firebase
  salt: string,          // base64 from Firebase
  config: FirebaseScryptConfig
): string {
  // Returns PHC-format string: $firebase-scrypt$...
}
```

**Implementation steps**:
1. Port the PHC encoding logic from bulk tool
2. Validate signer key and salt separator are valid base64
3. Encode hash + salt + config into single PHC string
4. Set `password_hash_type` to `'firebase-scrypt'`

### Shared Org/Role Mappers

**Overview**: Both transformers need to read org mapping CSVs and role mapping CSVs. Extract shared logic.

```typescript
// src/transformers/shared/org-mapper.ts
export async function loadOrgMapping(path: string): Promise<Map<string, { orgExternalId: string; orgName: string }>> {
  // Parse CSV with columns: user_id_column, org_external_id, org_name
}

// src/transformers/shared/role-mapper.ts
export async function loadRoleMapping(path: string): Promise<Map<string, string[]>> {
  // Parse CSV with columns: user_id_column, role_slug
  // Returns map of user_id -> [role_slugs]
}
```

**Implementation steps**:
1. Create generic CSV reader for mapping files
2. Support flexible column names (auto-detect user ID column)
3. Role mapper returns array of slugs per user (supports multi-role)

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|---------|
| `src/transformers/__tests__/clerk.test.ts` | Clerk column mapping, org/role join, edge cases |
| `src/transformers/__tests__/firebase.test.ts` | JSON parsing, name splitting, scrypt encoding, claims mapping |

**Key test cases**:
- Clerk transform maps all column name variations correctly
- Clerk transform with org and role mappings produces correct multi-membership output
- Firebase transform handles users with/without displayName
- Firebase name splitting strategies produce expected results
- Firebase scrypt PHC encoding matches expected format
- Firebase disabled user filtering works
- Firebase custom claims mapped to metadata JSON correctly
- Both transformers skip users missing email and log them

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run build
npm test

# Manual tests
node dist/index.js transform-clerk --help
node dist/index.js transform-firebase --help
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
