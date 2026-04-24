# Implementation Spec: Merge Bulk Import Features - Phase 7 (Interactive Wizard)

**Contract**: ./contract.md
**Depends on**: All previous phases (1-6)
**Estimated Effort**: M

## Technical Approach

Port the interactive wizard from the bulk tool. The wizard provides a guided, step-by-step migration flow that walks users through the entire process: selecting a source provider, entering credentials, configuring export options, running the export, merging passwords, validating the CSV, configuring import options, running the import, and handling post-import tasks (TOTP, roles).

The wizard uses the `prompts` library (not Inquirer) for interactive prompts, which works well with Commander since it's used within a command action handler rather than driving the entire CLI. The wizard essentially orchestrates calls to the same code that the individual commands use.

## File Changes

### New Files

| File Path | Purpose |
|-----------|---------|
| `src/cli/commands/wizard.ts` | Commander wizard subcommand |
| `src/wizard/wizard.ts` | Main wizard orchestrator |
| `src/wizard/steps/provider-selection.ts` | Step 1: Select source provider |
| `src/wizard/steps/credentials.ts` | Step 2: Enter provider credentials |
| `src/wizard/steps/export-config.ts` | Step 3: Configure export options |
| `src/wizard/steps/export-run.ts` | Step 4: Run export/transform |
| `src/wizard/steps/password-merge.ts` | Step 5: Password hash merge (optional) |
| `src/wizard/steps/validation.ts` | Step 6: CSV validation with auto-fix |
| `src/wizard/steps/import-config.ts` | Step 7: Configure import options |
| `src/wizard/steps/import-run.ts` | Step 8: Run import |
| `src/wizard/steps/post-import.ts` | Step 9: Post-import (TOTP, roles) |
| `src/wizard/steps/summary.ts` | Step 10: Final summary and next steps |

### Modified Files

| File Path | Changes |
|-----------|---------|
| `src/cli/index.ts` | Register wizard command |

## Implementation Details

### Wizard Command

```typescript
// src/cli/commands/wizard.ts
export function registerWizardCommand(program: Command): void {
  program
    .command('wizard')
    .description('Guided step-by-step migration wizard')
    .action(async () => {
      const wizard = new MigrationWizard();
      await wizard.run();
    });
}
```

### Wizard Orchestrator

**Pattern to follow**: `~/Documents/workos-bulk-user-import-tool-multi-org/src/wizard/wizard.ts`

**Overview**: The wizard maintains state across steps and drives the user through the full migration workflow. Each step is a function that prompts the user, performs work, and returns updated state.

```typescript
// src/wizard/wizard.ts
import prompts from 'prompts';

export interface WizardState {
  provider?: 'auth0' | 'clerk' | 'firebase' | 'csv';
  credentials?: Record<string, string>;
  exportOptions?: Record<string, any>;
  csvFilePath?: string;
  passwordsPath?: string;
  importOptions?: Record<string, any>;
  totpFilePath?: string;
  roleDefinitionsPath?: string;
  summary?: Record<string, any>;
}

export class MigrationWizard {
  private state: WizardState = {};

  async run(): Promise<void> {
    console.log(chalk.blue.bold('\nWorkOS Migration Wizard\n'));
    console.log(chalk.gray('This wizard will guide you through migrating users to WorkOS.\n'));

    // Step 1: Provider selection
    await this.selectProvider();

    // Step 2: Credentials
    await this.enterCredentials();

    // Step 3: Export/Transform configuration
    await this.configureExport();

    // Step 4: Run export/transform
    await this.runExport();

    // Step 5: Password merge (optional, Auth0 only)
    if (this.state.provider === 'auth0') {
      await this.passwordMerge();
    }

    // Step 6: Validate
    await this.validateCsv();

    // Step 7: Import configuration
    await this.configureImport();

    // Step 8: Confirmation and import
    await this.runImport();

    // Step 9: Post-import tools
    await this.postImport();

    // Step 10: Summary
    await this.showSummary();
  }
}
```

**Key decisions**:
- Uses `prompts` library (not Inquirer) — lighter weight, works as a dependency of a command
- Each step is cancellable (Ctrl+C gracefully exits with current state summary)
- Steps that involve long-running operations (export, import) show progress bars
- Confirmation prompts before destructive actions (import, TOTP enrollment)
- State passed between steps, not persisted to disk (wizard is a single session)

### Step Implementations

Each step follows the same pattern:

1. Display step header with explanation
2. Prompt user for inputs using `prompts`
3. Validate inputs
4. Execute the step (calling into the same code as the CLI commands)
5. Display results
6. Update wizard state
7. Ask if user wants to continue or adjust

**Step 1 — Provider Selection**:
```typescript
const response = await prompts({
  type: 'select',
  name: 'provider',
  message: 'Which identity provider are you migrating from?',
  choices: [
    { title: 'Auth0', value: 'auth0' },
    { title: 'Clerk', value: 'clerk' },
    { title: 'Firebase Auth', value: 'firebase' },
    { title: 'Custom CSV', value: 'csv' },
  ],
});
```

**Step 2 — Credentials**: Provider-specific credential prompts. For Auth0: domain, client ID, client secret. For CSV: WorkOS API key. Test connection before proceeding.

**Step 3 — Export Config**: Provider-specific options (rate limit, orgs filter, etc.). For CSV provider, ask for CSV file path and skip export.

**Step 4 — Run Export**: Call the export/transform engine from Phase 3/4. Show progress. Confirm output file location.

**Step 5 — Password Merge**: Ask if user has Auth0 password export NDJSON. If yes, run merge. If no, explain the Auth0 support process and that users will need to reset passwords.

**Step 6 — Validate**: Run validator from Phase 5 on the CSV. Show results. If errors, offer auto-fix. If auto-fix, re-validate.

**Step 7 — Import Config**: Concurrency, workers, org settings, dry-run option. Explain what each option does.

**Step 8 — Run Import**: Show import plan first. Confirm before executing. Show progress and summary.

**Step 9 — Post-Import**: Ask about TOTP enrollment and role processing. Run if user has the files.

**Step 10 — Summary**: Display final statistics, any remaining errors, and suggested next steps.

**Implementation steps**:
1. Create wizard command registration
2. Create wizard orchestrator with state management
3. Implement each step as a separate module
4. Wire steps to call Phase 2-6 code (not reimplementing logic)
5. Add progress display and error handling for each step
6. Add cancellation handling (Ctrl+C)
7. Test the full flow manually

## Testing Requirements

### Unit Tests

Testing the wizard is primarily manual since it's interactive. However, we can test the step logic in isolation.

**Key test cases** (manual):
- [ ] Full Auth0 flow: select Auth0 → enter creds → configure export → export → merge passwords → validate → import (dry-run) → summary
- [ ] Full Clerk flow: select Clerk → provide CSV → transform → validate → import (dry-run)
- [ ] Full Firebase flow: select Firebase → provide JSON → transform → validate → import (dry-run)
- [ ] Custom CSV flow: select CSV → provide file → validate → import (dry-run)
- [ ] Cancellation at each step gracefully exits
- [ ] Auto-fix in validation step corrects issues and re-validates
- [ ] Post-import TOTP step works when TOTP file provided

## Validation Commands

```bash
npm run typecheck
npm run lint
npm run build
npm test

# Manual test
node dist/index.js wizard
```

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
