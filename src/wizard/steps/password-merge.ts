import fs from 'node:fs';
import prompts from 'prompts';
import chalk from 'chalk';
import type { WizardState } from '../wizard.js';
import {
  loadPasswordHashes,
  mergePasswordsIntoCsv,
} from '../../exporters/auth0/password-merger.js';

export async function mergePasswords(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 5: Password Hash Merge\n'));

  const response = await prompts({
    type: 'confirm',
    name: 'hasPasswords',
    message: 'Do you have an Auth0 password hash export (NDJSON)?',
    initial: false,
  }, { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled) return state;

  if (!response.hasPasswords) {
    console.log(chalk.gray('  Skipping password merge.'));
    console.log(chalk.gray('  Users will need to reset passwords on first login.'));
    console.log(chalk.gray('  To get password hashes, request an export from Auth0 support.\n'));
    return state;
  }

  const fileResponse = await prompts({
    type: 'text',
    name: 'passwordsPath',
    message: 'Path to Auth0 password hash NDJSON file',
    validate: (v: string) => fs.existsSync(v) || 'File not found',
  }, { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled) return state;

  state.auth0PasswordsPath = fileResponse.passwordsPath;

  console.log(chalk.blue('\n  Loading password hashes...'));

  try {
    const passwordLookup = await loadPasswordHashes(state.auth0PasswordsPath!);
    const passwordCount = Object.keys(passwordLookup).length;
    console.log(chalk.green(`  Loaded ${passwordCount} password hashes`));

    const outputPath = state.csvFilePath!.replace('.csv', '-with-passwords.csv');
    console.log(chalk.blue('  Merging passwords into CSV...'));

    const stats = await mergePasswordsIntoCsv(state.csvFilePath!, outputPath, passwordLookup);

    console.log(chalk.green('\n  Merge complete'));
    console.log(`    Total rows: ${stats.totalRows}`);
    console.log(`    Passwords added: ${stats.passwordsAdded}`);
    console.log(`    No password found: ${stats.passwordsNotFound}\n`);

    // Update CSV path to merged file
    state.csvFilePath = outputPath;
  } catch (err) {
    console.error(chalk.red(`\n  Password merge failed: ${(err as Error).message}`));
    console.log(chalk.gray('  Continuing without passwords.\n'));
  }

  return state;
}
