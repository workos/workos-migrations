import fs from 'node:fs';
import prompts from 'prompts';
import chalk from 'chalk';
import type { WizardState } from '../wizard.js';
import {
  loadPasswordHashes,
  mergePasswordsIntoCsv,
  mergePasswordsIntoPackage,
} from '../../exporters/auth0/password-merger.js';
import { mergeSupabasePasswords } from '../../exporters/supabase/password-merger.js';

export async function mergePasswords(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 5: Password Hash Merge\n'));

  if (state.provider === 'supabase') {
    return mergeSupabasePasswordsStep(state);
  }

  return mergeAuth0Passwords(state);
}

async function mergeAuth0Passwords(state: WizardState): Promise<WizardState> {
  const response = await prompts(
    {
      type: 'confirm',
      name: 'hasPasswords',
      message: 'Do you have an Auth0 password hash export (NDJSON)?',
      initial: false,
    },
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  if (!response.hasPasswords) {
    console.log(chalk.gray('  Skipping password merge.'));
    console.log(chalk.gray('  Users will need to reset passwords on first login.'));
    console.log(chalk.gray('  To get password hashes, request an export from Auth0 support.\n'));
    return state;
  }

  const fileResponse = await prompts(
    {
      type: 'text',
      name: 'passwordsPath',
      message: 'Path to Auth0 password hash NDJSON file',
      validate: (v: string) => fs.existsSync(v) || 'File not found',
    },
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  state.auth0PasswordsPath = fileResponse.passwordsPath;

  console.log(chalk.blue('\n  Loading password hashes...'));

  try {
    if (state.auth0Package && state.auth0PackageDir) {
      console.log(chalk.blue('  Merging passwords into migration package...'));
      const stats = await mergePasswordsIntoPackage({
        packageDir: state.auth0PackageDir,
        passwordsPath: state.auth0PasswordsPath!,
      });

      console.log(chalk.green('\n  Merge complete'));
      console.log(`    Total rows: ${stats.totalRows}`);
      console.log(`    Passwords added: ${stats.passwordsAdded}`);
      console.log(`    No password found: ${stats.passwordsNotFound}`);
      console.log(`    Rejected (unsupported algorithm): ${stats.passwordsRejectedAlgorithm}`);
      console.log(`    workos_upload rows updated: ${stats.uploadRowsUpdated}\n`);

      for (const warning of stats.warnings) {
        if (warning.code === 'unsupported_password_hash_algorithm') {
          console.log(chalk.yellow(`    ${warning.message}`));
        }
      }
      // csvFilePath continues to point at the package's users.csv,
      // which has been updated in-place with password hashes.
    } else {
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
    }
  } catch (err) {
    console.error(chalk.red(`\n  Password merge failed: ${(err as Error).message}`));
    console.log(chalk.gray('  Continuing without passwords.\n'));
  }

  return state;
}

async function mergeSupabasePasswordsStep(state: WizardState): Promise<WizardState> {
  if (!state.supabaseDbUrl) {
    console.log(chalk.gray('  Skipping password merge (SUPABASE_DB_URL not set).\n'));
    return state;
  }
  if (!state.supabasePackageDir) {
    console.log(
      chalk.gray('  Skipping password merge (Supabase package directory not configured).\n'),
    );
    return state;
  }

  const response = await prompts(
    {
      type: 'confirm',
      name: 'mergeNow',
      message: 'Merge bcrypt password hashes from Supabase Postgres into the package?',
      initial: true,
    },
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  if (!response.mergeNow) {
    console.log(chalk.gray('  Skipping password merge.'));
    console.log(
      chalk.gray(
        '  You can run it later with: workos-migrate merge-passwords-supabase --package <dir> --db-url <url>\n',
      ),
    );
    return state;
  }

  console.log(chalk.blue('\n  Querying auth.users.encrypted_password...'));

  try {
    const stats = await mergeSupabasePasswords({
      packageDir: state.supabasePackageDir,
      dbUrl: state.supabaseDbUrl,
      quiet: false,
    });

    console.log(chalk.green('\n  Merge complete'));
    console.log(`    Total rows: ${stats.totalRows}`);
    console.log(`    Matched: ${stats.matched}`);
    console.log(`    Missing in DB: ${stats.missing}`);
    console.log(`    Unsupported algorithm: ${stats.unsupportedAlgo}`);
    console.log(`    workos_upload rows updated: ${stats.uploadRowsUpdated}`);
    console.log(`    Warnings: ${stats.warnings.length}\n`);
  } catch (err) {
    console.error(chalk.red(`\n  Password merge failed: ${(err as Error).message}`));
    console.log(chalk.gray('  Continuing without passwords.\n'));
  }

  return state;
}
