import chalk from 'chalk';
import type { WizardState } from '../wizard.js';
import { exportAuth0 } from '../../exporters/auth0/exporter.js';
import { transformClerkExport } from '../../transformers/clerk/transformer.js';
import { transformFirebaseExport } from '../../transformers/firebase/transformer.js';
import { CognitoClient } from '../../providers/cognito/index.js';
import type { FirebaseScryptConfig } from '../../shared/types.js';

export async function runExport(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 4: Export / Transform\n'));

  if (state.provider === 'csv') {
    console.log(chalk.gray('  Using existing CSV — skipping export step.\n'));
    return state;
  }

  if (state.provider === 'auth0') {
    return runAuth0Export(state);
  }
  if (state.provider === 'clerk') {
    return runClerkTransform(state);
  }
  if (state.provider === 'firebase') {
    return runFirebaseTransform(state);
  }
  if (state.provider === 'cognito') {
    return runCognitoExport(state);
  }

  return state;
}

async function runAuth0Export(state: WizardState): Promise<WizardState> {
  console.log(chalk.blue('  Exporting users from Auth0...\n'));

  try {
    await exportAuth0({
      domain: state.auth0Domain!,
      clientId: state.auth0ClientId!,
      clientSecret: state.auth0ClientSecret!,
      output: state.csvFilePath!,
      pageSize: 100,
      rateLimit: state.auth0RateLimit ?? 50,
      userFetchConcurrency: 10,
      useMetadata: state.auth0UseMetadata ?? false,
      resume: false,
      quiet: false,
    });

    console.log(chalk.green(`\n  Export complete: ${state.csvFilePath}\n`));
  } catch (err) {
    console.error(chalk.red(`\n  Auth0 export failed: ${(err as Error).message}`));
    console.log(chalk.gray('  You can retry with: workos-migrate export-auth0\n'));
    state.cancelled = true;
  }

  return state;
}

async function runClerkTransform(state: WizardState): Promise<WizardState> {
  console.log(chalk.blue('  Transforming Clerk export...\n'));

  try {
    const summary = await transformClerkExport({
      input: state.clerkCsvPath!,
      output: state.csvFilePath!,
      orgMapping: state.clerkOrgMapping,
      roleMapping: state.clerkRoleMapping,
      quiet: false,
    });

    console.log(chalk.green('\n  Transform complete'));
    console.log(`    Total users: ${summary.totalUsers}`);
    console.log(`    Transformed: ${summary.transformedUsers}`);
    console.log(`    Skipped: ${summary.skippedUsers}`);
    console.log(`    With passwords: ${summary.usersWithPasswords}`);
    if (summary.usersWithOrgMapping > 0) {
      console.log(`    With org mapping: ${summary.usersWithOrgMapping}`);
    }
    if (summary.usersWithRoleMapping > 0) {
      console.log(`    With role mapping: ${summary.usersWithRoleMapping}`);
    }
    console.log();
  } catch (err) {
    console.error(chalk.red(`\n  Clerk transform failed: ${(err as Error).message}`));
    state.cancelled = true;
  }

  return state;
}

async function runFirebaseTransform(state: WizardState): Promise<WizardState> {
  console.log(chalk.blue('  Transforming Firebase export...\n'));

  let scryptConfig: FirebaseScryptConfig | undefined;
  if (state.firebaseSignerKey) {
    scryptConfig = {
      signerKey: state.firebaseSignerKey,
      saltSeparator: state.firebaseSaltSeparator || '',
      rounds: state.firebaseRounds ?? 8,
      memoryCost: state.firebaseMemCost ?? 14,
    };
  }

  try {
    const summary = await transformFirebaseExport({
      input: state.firebaseJsonPath!,
      output: state.csvFilePath!,
      scryptConfig,
      nameSplitStrategy: state.firebaseNameSplit ?? 'first-space',
      includeDisabled: state.firebaseIncludeDisabled,
      orgMapping: state.firebaseOrgMapping,
      roleMapping: state.firebaseRoleMapping,
      quiet: false,
    });

    console.log(chalk.green('\n  Transform complete'));
    console.log(`    Total users: ${summary.totalUsers}`);
    console.log(`    Transformed: ${summary.transformedUsers}`);
    console.log(`    Skipped: ${summary.skippedUsers}`);
    console.log(`    With passwords: ${summary.usersWithPasswords}`);
    if (summary.usersWithOrgMapping > 0) {
      console.log(`    With org mapping: ${summary.usersWithOrgMapping}`);
    }
    console.log();

    if (!scryptConfig) {
      console.log(
        chalk.yellow('  Note: No scrypt parameters provided. Users will need to reset passwords.'),
      );
      console.log(
        chalk.gray(
          '  Get params from Firebase Console > Authentication > Password Hash Parameters\n',
        ),
      );
    }
  } catch (err) {
    console.error(chalk.red(`\n  Firebase transform failed: ${(err as Error).message}`));
    state.cancelled = true;
  }

  return state;
}

async function runCognitoExport(state: WizardState): Promise<WizardState> {
  console.log(chalk.blue('  Exporting from AWS Cognito...\n'));

  try {
    const credentials = {
      region: state.cognitoRegion!,
      userPoolIds: state.cognitoUserPoolIds!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      sessionToken: process.env.AWS_SESSION_TOKEN ?? '',
    };

    const client = new CognitoClient(credentials, {
      userPoolIds: state.cognitoUserPoolIds!.split(',').map((s) => s.trim()),
      outDir: state.cognitoOutputDir ?? '.',
    });

    await client.authenticate();

    const entities = (state.cognitoEntities ?? 'connections,users').split(',');
    const result = await client.exportEntities(entities);

    console.log(chalk.green('\n  Export complete'));
    for (const [key, count] of Object.entries(result.summary)) {
      console.log(`    ${key}: ${count}`);
    }

    // Cognito export produces separate CSVs (connections + users), not a single
    // import-ready CSV. The user CSV can be passed into the validation + import
    // pipeline; connections are imported separately.
    const outputFiles = result.entities.output_files as string[] | undefined;
    const usersFile = outputFiles?.find((f) => f.includes('workos_users'));
    if (usersFile) {
      state.csvFilePath = usersFile;
      console.log(chalk.gray(`\n  Users CSV for import pipeline: ${usersFile}`));
    }

    console.log();
  } catch (err) {
    console.error(chalk.red(`\n  Cognito export failed: ${(err as Error).message}`));
    console.log(chalk.gray('  You can retry with: workos-migrate export-cognito\n'));
    state.cancelled = true;
  }

  return state;
}
