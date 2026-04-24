import prompts from 'prompts';
import chalk from 'chalk';
import type { WizardState } from '../wizard.js';

export async function configureImport(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 7: Import Configuration\n'));

  const response = await prompts([
    {
      type: 'number',
      name: 'concurrency',
      message: 'Concurrent API requests',
      initial: 10,
      min: 1,
      max: 50,
    },
    {
      type: 'number',
      name: 'rateLimit',
      message: 'Max requests per second',
      initial: 50,
      min: 1,
      max: 200,
    },
    {
      type: 'select',
      name: 'orgMode',
      message: 'Organization import mode',
      choices: [
        { title: 'User only', value: 'user-only', description: 'Import users without org memberships' },
        { title: 'Single org', value: 'single-org', description: 'Assign all users to one organization' },
        { title: 'Multi org (from CSV)', value: 'multi-org', description: 'Org mapping columns in CSV' },
      ],
    },
    {
      type: (prev: string) => prev === 'single-org' ? 'text' : null,
      name: 'orgId',
      message: 'WorkOS Organization ID or External ID',
      validate: (v: string) => v.length > 0 || 'Required',
    },
    {
      type: (prev: string, values: Record<string, unknown>) => values.orgMode === 'multi-org' ? 'confirm' : null,
      name: 'createOrgIfMissing',
      message: 'Auto-create organizations not found in WorkOS?',
      initial: true,
    },
    {
      type: 'confirm',
      name: 'dryRun',
      message: 'Run as dry-run first (recommended)?',
      initial: true,
    },
  ], { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled) return state;

  state.concurrency = response.concurrency;
  state.rateLimit = response.rateLimit;
  state.dryRun = response.dryRun;
  state.createOrgIfMissing = response.createOrgIfMissing ?? false;

  if (response.orgMode === 'single-org' && response.orgId) {
    if (response.orgId.startsWith('org_')) {
      state.orgId = response.orgId;
    } else {
      state.orgExternalId = response.orgId;
    }
  }

  state.jobId = `wizard-${Date.now()}`;
  state.errorsPath = 'errors.jsonl';

  console.log(chalk.green('\n  Import configured.\n'));
  return state;
}
