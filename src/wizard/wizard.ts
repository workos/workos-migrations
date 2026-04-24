import chalk from 'chalk';
import { selectProvider } from './steps/provider-selection.js';
import { enterCredentials } from './steps/credentials.js';
import { configureExport } from './steps/export-config.js';
import { runExport } from './steps/export-run.js';
import { mergePasswords } from './steps/password-merge.js';
import { runValidation } from './steps/validation.js';
import { configureImport } from './steps/import-config.js';
import { runImportStep } from './steps/import-run.js';
import { runPostImport } from './steps/post-import.js';
import { showSummary } from './steps/summary.js';

export type Provider = 'auth0' | 'clerk' | 'firebase' | 'cognito' | 'csv';

export interface WizardState {
  // Step 1: Provider
  provider?: Provider;

  // Step 2: Credentials
  auth0Domain?: string;
  auth0ClientId?: string;
  auth0ClientSecret?: string;
  workosApiKey?: string;

  // Step 3: Export config
  auth0RateLimit?: number;
  auth0Orgs?: string[];
  auth0UseMetadata?: boolean;
  clerkCsvPath?: string;
  clerkOrgMapping?: string;
  clerkRoleMapping?: string;
  firebaseJsonPath?: string;
  firebaseOrgMapping?: string;
  firebaseRoleMapping?: string;
  firebaseNameSplit?: 'first-space' | 'last-space' | 'first-name-only';
  firebaseSignerKey?: string;
  firebaseSaltSeparator?: string;
  firebaseRounds?: number;
  firebaseMemCost?: number;
  firebaseIncludeDisabled?: boolean;
  cognitoRegion?: string;
  cognitoUserPoolIds?: string;
  cognitoEntities?: string;
  cognitoOutputDir?: string;
  customCsvPath?: string;

  // Step 4: Export output
  csvFilePath?: string;

  // Step 5: Password merge
  auth0PasswordsPath?: string;

  // Step 6: Validation
  validationPassed?: boolean;
  fixesApplied?: number;

  // Step 7: Import config
  concurrency?: number;
  rateLimit?: number;
  workers?: number;
  orgId?: string;
  orgExternalId?: string;
  createOrgIfMissing?: boolean;
  dryRun?: boolean;
  jobId?: string;

  // Step 8: Import result
  importSuccesses?: number;
  importFailures?: number;
  errorsPath?: string;

  // Step 9: Post-import
  totpFilePath?: string;
  totpIssuer?: string;
  roleDefinitionsPath?: string;
  roleUserMappingPath?: string;

  // Step 10: Summary
  cancelled?: boolean;
}

export class MigrationWizard {
  state: WizardState = {};

  async run(): Promise<void> {
    console.log(chalk.blue.bold('\n  WorkOS Migration Wizard\n'));
    console.log(chalk.gray('  This wizard will guide you through migrating users to WorkOS.\n'));
    console.log(chalk.gray('  Press Ctrl+C at any time to exit.\n'));

    try {
      // Step 1: Provider selection
      this.state = await selectProvider(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 2: Credentials
      this.state = await enterCredentials(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 3: Export/Transform configuration
      this.state = await configureExport(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 4: Run export/transform
      this.state = await runExport(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 5: Password merge (Auth0 only)
      if (this.state.provider === 'auth0') {
        this.state = await mergePasswords(this.state);
        if (this.state.cancelled) return this.onCancel();
      }

      // Step 6: Validate CSV
      this.state = await runValidation(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 7: Import configuration
      this.state = await configureImport(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 8: Run import
      this.state = await runImportStep(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 9: Post-import (TOTP, roles)
      this.state = await runPostImport(this.state);
      if (this.state.cancelled) return this.onCancel();

      // Step 10: Summary
      await showSummary(this.state);
    } catch (err) {
      if ((err as Error).message?.includes('cancelled')) {
        return this.onCancel();
      }
      console.error(chalk.red(`\nWizard error: ${(err as Error).message}`));
      process.exit(1);
    }
  }

  private onCancel(): void {
    console.log(chalk.yellow('\n  Wizard cancelled.'));
    if (this.state.csvFilePath) {
      console.log(chalk.gray(`  Your CSV is at: ${this.state.csvFilePath}`));
    }
    console.log(chalk.gray('  You can run individual commands to continue where you left off.\n'));
  }
}
