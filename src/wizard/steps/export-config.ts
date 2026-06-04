import fs from 'node:fs';
import path from 'node:path';
import prompts from 'prompts';
import chalk from 'chalk';
import type { WizardState } from '../wizard.js';

export async function configureExport(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 3: Export Configuration\n'));

  if (state.provider === 'auth0') {
    return configureAuth0Export(state);
  }
  if (state.provider === 'clerk') {
    return configureClerkExport(state);
  }
  if (state.provider === 'firebase') {
    return configureFirebaseExport(state);
  }
  if (state.provider === 'cognito') {
    return configureCognitoExport(state);
  }
  if (state.provider === 'csv') {
    return configureCustomCsv(state);
  }

  return state;
}

async function configureAuth0Export(state: WizardState): Promise<WizardState> {
  // Ask mode and entities first so we can streamline the flow for SSO-only
  const modeResponse = await prompts(
    [
      {
        type: 'select',
        name: 'mode',
        message: 'Export shape',
        choices: [
          {
            title: 'Migration package (recommended — users, orgs, memberships, roles, SSO handoff)',
            value: 'package',
          },
          { title: 'Single users CSV (legacy)', value: 'csv' },
        ],
        initial: 0,
      },
      {
        type: (_: unknown, values: Record<string, unknown>) =>
          values.mode === 'package' ? 'multiselect' : null,
        name: 'entities',
        message: 'Entities to include in the package',
        choices: [
          { title: 'users', value: 'users', selected: true },
          { title: 'organizations', value: 'organizations', selected: true },
          { title: 'memberships', value: 'memberships', selected: true },
          { title: 'roles', value: 'roles', selected: true },
          { title: 'sso (handoff)', value: 'sso', selected: true },
        ],
        min: 1,
      },
    ],
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  const entities: string[] = modeResponse.entities ?? [];
  const isSsoOnly =
    modeResponse.mode === 'package' && entities.length === 1 && entities[0] === 'sso';

  // For SSO-only, skip user-export-related questions
  const detailsResponse = await prompts(
    [
      {
        type: isSsoOnly ? null : 'number',
        name: 'rateLimit',
        message: 'Auth0 API rate limit (requests/sec)',
        initial: 50,
        min: 1,
        max: 100,
      },
      {
        type: isSsoOnly ? null : 'confirm',
        name: 'useMetadata',
        message: 'Use user_metadata for org discovery (instead of Auth0 Organizations API)?',
        initial: false,
      },
      {
        type: modeResponse.mode === 'package' && !isSsoOnly ? 'select' : null,
        name: 'engine',
        message: 'User export engine',
        choices: [
          { title: 'Management API (default; preserves org membership)', value: 'management-api' },
          { title: 'Bulk job (fastest for very large tenants; users-only)', value: 'bulk-job' },
        ],
        initial: 0,
      },
      {
        type: modeResponse.mode === 'package' ? 'text' : null,
        name: 'outputDir',
        message: 'Output directory for the migration package',
        initial: './migration-auth0',
      },
      {
        type: modeResponse.mode === 'csv' ? 'text' : null,
        name: 'output',
        message: 'Output CSV file path',
        initial: 'auth0-export.csv',
      },
    ],
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  state.auth0RateLimit = detailsResponse.rateLimit ?? 50;
  state.auth0UseMetadata = detailsResponse.useMetadata ?? false;
  if (modeResponse.mode === 'package') {
    state.auth0Package = true;
    state.auth0PackageDir = detailsResponse.outputDir;
    state.auth0PackageEntities = entities;
    state.auth0PackageEngine = detailsResponse.engine ?? 'management-api';
    state.csvFilePath = `${detailsResponse.outputDir}/users.csv`;
  } else {
    state.auth0Package = false;
    state.csvFilePath = detailsResponse.output;
  }
  return state;
}

async function configureClerkExport(state: WizardState): Promise<WizardState> {
  console.log(chalk.gray('  Clerk requires a CSV export from the Clerk dashboard.\n'));

  const response = await prompts(
    [
      {
        type: 'text',
        name: 'csvPath',
        message: 'Path to Clerk export CSV',
        validate: (v: string) => fs.existsSync(v) || 'File not found',
      },
      {
        type: 'confirm',
        name: 'hasOrgMapping',
        message: 'Do you have an organization mapping CSV?',
        initial: false,
      },
      {
        type: (prev: boolean) => (prev ? 'text' : null),
        name: 'orgMapping',
        message: 'Path to org mapping CSV (clerk_user_id,org_external_id,org_name)',
        validate: (v: string) => fs.existsSync(v) || 'File not found',
      },
      {
        type: 'confirm',
        name: 'hasRoleMapping',
        message: 'Do you have a role mapping CSV?',
        initial: false,
      },
      {
        type: (prev: boolean) => (prev ? 'text' : null),
        name: 'roleMapping',
        message: 'Path to role mapping CSV (clerk_user_id,role_slug)',
        validate: (v: string) => fs.existsSync(v) || 'File not found',
      },
      {
        type: 'text',
        name: 'output',
        message: 'Output CSV file path',
        initial: 'clerk-transformed.csv',
      },
    ],
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  state.clerkCsvPath = response.csvPath;
  state.clerkOrgMapping = response.orgMapping;
  state.clerkRoleMapping = response.roleMapping;
  state.csvFilePath = response.output;
  return state;
}

async function configureFirebaseExport(state: WizardState): Promise<WizardState> {
  console.log(chalk.gray('  Firebase requires a JSON export from Firebase Auth.\n'));

  const response = await prompts(
    [
      {
        type: 'text',
        name: 'jsonPath',
        message: 'Path to Firebase Auth JSON export',
        validate: (v: string) => fs.existsSync(v) || 'File not found',
      },
      {
        type: 'select',
        name: 'nameSplit',
        message: 'How should displayName be split?',
        choices: [
          {
            title: 'First Space',
            value: 'first-space',
            description: '"John Michael Smith" -> first: John, last: Michael Smith',
          },
          {
            title: 'Last Space',
            value: 'last-space',
            description: '"John Michael Smith" -> first: John Michael, last: Smith',
          },
          {
            title: 'First Name Only',
            value: 'first-name-only',
            description: 'Put full name in first_name',
          },
        ],
      },
      {
        type: 'confirm',
        name: 'hasScryptParams',
        message: 'Do you have Firebase scrypt password hash parameters?',
        initial: false,
      },
      {
        type: (prev: boolean) => (prev ? 'text' : null),
        name: 'signerKey',
        message: 'Signer key (base64)',
        validate: (v: string) => v.length > 0 || 'Required',
      },
      {
        type: (_: unknown, values: Record<string, unknown>) =>
          values.hasScryptParams ? 'text' : null,
        name: 'saltSeparator',
        message: 'Salt separator (base64, press Enter for empty)',
        initial: '',
      },
      {
        type: (_: unknown, values: Record<string, unknown>) =>
          values.hasScryptParams ? 'number' : null,
        name: 'rounds',
        message: 'Rounds',
        initial: 8,
      },
      {
        type: (_: unknown, values: Record<string, unknown>) =>
          values.hasScryptParams ? 'number' : null,
        name: 'memCost',
        message: 'Memory cost',
        initial: 14,
      },
      {
        type: 'confirm',
        name: 'includeDisabled',
        message: 'Include disabled users?',
        initial: false,
      },
      {
        type: 'confirm',
        name: 'hasOrgMapping',
        message: 'Do you have an organization mapping CSV?',
        initial: false,
      },
      {
        type: (prev: boolean) => (prev ? 'text' : null),
        name: 'orgMapping',
        message: 'Path to org mapping CSV (firebase_uid,org_external_id,org_name)',
        validate: (v: string) => fs.existsSync(v) || 'File not found',
      },
      {
        type: 'confirm',
        name: 'hasRoleMapping',
        message: 'Do you have a role mapping CSV?',
        initial: false,
      },
      {
        type: (prev: boolean) => (prev ? 'text' : null),
        name: 'roleMapping',
        message: 'Path to role mapping CSV (firebase_uid,role_slug)',
        validate: (v: string) => fs.existsSync(v) || 'File not found',
      },
      {
        type: 'text',
        name: 'output',
        message: 'Output CSV file path',
        initial: 'firebase-transformed.csv',
      },
    ],
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  state.firebaseJsonPath = response.jsonPath;
  state.firebaseNameSplit = response.nameSplit;
  state.firebaseSignerKey = response.signerKey;
  state.firebaseSaltSeparator = response.saltSeparator;
  state.firebaseRounds = response.rounds;
  state.firebaseMemCost = response.memCost;
  state.firebaseIncludeDisabled = response.includeDisabled;
  state.firebaseOrgMapping = response.orgMapping;
  state.firebaseRoleMapping = response.roleMapping;
  state.csvFilePath = response.output;
  return state;
}

async function configureCognitoExport(state: WizardState): Promise<WizardState> {
  console.log(chalk.gray('  Cognito export connects to your user pool(s) via the AWS SDK.\n'));

  const response = await prompts(
    [
      {
        type: 'multiselect',
        name: 'entities',
        message: 'Which entities should be exported?',
        choices: [
          { title: 'Connections (SAML + OIDC)', value: 'connections', selected: true },
          { title: 'Users', value: 'users', selected: true },
        ],
        min: 1,
      },
      {
        type: 'text',
        name: 'outputDir',
        message: 'Output directory for CSV files',
        initial: '.',
      },
    ],
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  state.cognitoEntities = response.entities.join(',');
  state.cognitoOutputDir = response.outputDir;
  return state;
}

async function configureCustomCsv(state: WizardState): Promise<WizardState> {
  console.log(chalk.gray('  Provide a CSV already in WorkOS import format.\n'));

  const modeResponse = await prompts(
    {
      type: 'select',
      name: 'mode',
      message: 'Do you have a CSV ready or do you need a blank template?',
      choices: [
        { title: 'I have a CSV file', value: 'existing' },
        { title: 'Generate a blank CSV template', value: 'template' },
      ],
    },
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  if (modeResponse.mode === 'template') {
    return generateCsvTemplate(state);
  }

  const response = await prompts(
    {
      type: 'text',
      name: 'csvPath',
      message: 'Path to your CSV file',
      validate: (v: string) => fs.existsSync(v) || 'File not found',
    },
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  state.customCsvPath = response.csvPath;
  state.csvFilePath = response.csvPath;
  return state;
}

async function generateCsvTemplate(state: WizardState): Promise<WizardState> {
  const { getAllTemplates, generateTemplateExample } =
    await import('../../providers/csv/templates.js');
  const templates = getAllTemplates();

  const response = await prompts(
    [
      {
        type: 'select',
        name: 'template',
        message: 'Which template do you need?',
        choices: templates.map((t) => ({
          title: t.name,
          value: t.name.toLowerCase().replace(/ /g, '_'),
          description: `${t.description} (${t.filename})`,
        })),
      },
      {
        type: 'text',
        name: 'output',
        message: 'Output file path',
        initial: (_: unknown, values: Record<string, unknown>) => {
          const tmpl = templates.find(
            (t) => t.name.toLowerCase().replace(/ /g, '_') === values.template,
          );
          return tmpl?.filename ?? 'template.csv';
        },
      },
    ],
    {
      onCancel: () => {
        state.cancelled = true;
      },
    },
  );

  if (state.cancelled) return state;

  const content = generateTemplateExample(response.template) + '\n';
  const outputPath = path.resolve(response.output);
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, content, 'utf-8');

  console.log(chalk.green(`\n  Template written to ${outputPath}`));
  console.log(chalk.gray('  Fill in the template, then re-run the wizard with "Custom CSV".\n'));

  state.cancelled = true;
  return state;
}
