# Implementation Spec: Merge Bulk Import Features - Phase 5 (Validation + Error Analysis)

**Contract**: ./contract.md
**Depends on**: Phase 1 (Foundation), Phase 2 (Import Pipeline — for error types)
**Can run in parallel with**: Phase 6
**Estimated Effort**: M

## Technical Approach

Port the bulk tool's 3-pass CSV validator (with auto-fix) and the error analysis command. The existing validator in workos-migrations is basic (header checking, required field validation). The bulk tool's validator adds metadata validation (valid JSON, string-only values, reserved field name detection), duplicate detection, cross-row consistency checks, and an auto-fix mode that corrects common issues automatically.

The error analysis command reads the JSONL error output from an import run, groups errors by type and pattern, suggests fixes, and can generate a retry CSV containing only the failed rows.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/commands/validate.ts` | Commander validate subcommand (replaces placeholder from Phase 1) |
| `src/cli/commands/analyze.ts` | Commander analyze subcommand |
| `src/validator/validator.ts` | 3-pass CSV validator |
| `src/validator/auto-fixer.ts` | Auto-fix common validation issues |
| `src/validator/rules.ts` | Validation rule definitions |
| `src/analyzer/analyzer.ts` | Error JSONL analysis engine |
| `src/analyzer/retry-generator.ts` | Retry CSV generator from error analysis |
| `src/validator/__tests__/validator.test.ts` | Validator tests |
| `src/analyzer/__tests__/analyzer.test.ts` | Analyzer tests |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `src/cli/index.ts` | Register validate and analyze commands |

### Deleted Files

| File Path | Reason |
|-----------|--------|
| `src/providers/csv/validator.ts` | Already deleted in Phase 1, replaced by `src/validator/` |

## Implementation Details

### Validate Command

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/validator/`

```typescript
// src/cli/commands/validate.ts
export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate a WorkOS migration CSV file')
    .requiredOption('--csv <path>', 'CSV file to validate')
    .option('--auto-fix', 'Automatically fix common issues')
    .option('--output <path>', 'Output fixed CSV (only with --auto-fix)')
    .option('--strict', 'Treat warnings as errors')
    .option('--quiet', 'Only show errors, not warnings')
    .action(async (opts) => { /* validate */ });
}
```

### 3-Pass Validator

**Overview**: Validates CSV files in three passes for thoroughness.

**Pass 1 — Structure**: Headers present, required columns exist, no unexpected columns (warning, not error), file readable.

**Pass 2 — Row validation**: For each row:
- Email required and valid format
- Email verified is boolean-parseable (true/false/yes/no/1/0)
- Metadata is valid JSON if present
- Metadata values are all strings (auto-fix: coerce arrays/objects to JSON strings)
- Reserved metadata field names detected (org_id, org_name, etc.) — auto-fix: rename with prefix
- Password hash and password_hash_type are both present or both absent
- Org columns: can't have both org_id AND org_external_id in same row

**Pass 3 — Cross-row checks**:
- Duplicate email detection (for user-only mode)
- Multi-membership consistency (same email, different orgs = OK; same email, same org = duplicate)
- Consistent user data across rows with same email (first_name, last_name should match)

```typescript
// src/validator/validator.ts
export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  totalRows: number;
  validRows: number;
  fixesApplied?: number;
}

export interface ValidationIssue {
  row?: number;
  column?: string;
  message: string;
  severity: 'error' | 'warning';
  fixable: boolean;
}
```

**Implementation steps**:
1. Create rule definitions for each validation check
2. Implement 3-pass validation pipeline
3. Implement auto-fixer that corrects fixable issues and writes new CSV
4. Display results with color-coded output

### Auto-Fixer

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/validator/autoFixer.ts`

**Fixable issues**:
- Metadata values that are arrays/objects → JSON-stringify them to strings
- Reserved metadata field names → prefix with `auth0_` or source provider name
- Boolean fields with non-standard values (Yes/No/1/0) → normalize to true/false
- Whitespace in emails → trim
- Empty rows → remove

**Implementation steps**:
1. During Pass 2, collect fixable issues
2. If `--auto-fix`, apply fixes to in-memory rows
3. Write fixed CSV to `--output` path (or overwrite input if no output specified)
4. Report fixes applied count

### Analyze Command

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/analyzer/`

```typescript
// src/cli/commands/analyze.ts
export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze')
    .description('Analyze import errors and generate retry plan')
    .requiredOption('--errors <path>', 'Error JSONL file from import')
    .option('--retry-csv <path>', 'Generate retry CSV for retryable errors')
    .option('--original-csv <path>', 'Original CSV (needed for --retry-csv)')
    .option('--dedupe', 'Deduplicate retry CSV by email')
    .option('--json', 'Output analysis as JSON')
    .action(async (opts) => { /* analyze */ });
}
```

### Error Analyzer

**Overview**: Reads error JSONL, groups by pattern, classifies retryability, suggests fixes.

```typescript
// src/analyzer/analyzer.ts
export interface AnalysisResult {
  totalErrors: number;
  errorGroups: ErrorGroup[];
  retryableCount: number;
  nonRetryableCount: number;
  suggestions: string[];
}

export interface ErrorGroup {
  pattern: string;
  count: number;
  errorType: string;
  retryable: boolean;
  suggestion: string;
  examples: ErrorRecord[];
}
```

**Error classification**:
- Rate limit (429) → retryable
- Timeout → retryable
- User already exists (409) → non-retryable (not really an error)
- Invalid email → non-retryable
- Org not found → retryable if `--create-org-if-missing` was missing
- Permission denied (403) → non-retryable

**Implementation steps**:
1. Parse JSONL file line by line
2. Group errors by message pattern (normalize variable parts like IDs)
3. Classify each group as retryable or not
4. Generate suggestions per group
5. If `--retry-csv`, extract retryable rows from original CSV
6. Display formatted analysis report

## Testing Requirements

### Unit Tests

| Test File | Coverage |
|-----------|---------|
| `src/validator/__tests__/validator.test.ts` | All validation rules, 3-pass behavior, edge cases |
| `src/analyzer/__tests__/analyzer.test.ts` | Error grouping, classification, retry CSV generation |

**Key test cases**:
- Valid CSV passes all three passes
- Missing email column detected in Pass 1
- Invalid metadata JSON detected in Pass 2
- Duplicate emails detected in Pass 3
- Auto-fix corrects metadata value types
- Auto-fix renames reserved metadata fields
- Error analyzer groups by pattern correctly
- Error analyzer generates retry CSV with only retryable rows
- Error analyzer deduplicates by email when requested

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run build
npm test

# Manual tests
node dist/index.js validate --help
node dist/index.js analyze --help
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
