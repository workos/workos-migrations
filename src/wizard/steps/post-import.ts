import fs from 'node:fs';
import prompts from 'prompts';
import chalk from 'chalk';
import type { WizardState } from '../wizard.js';
import { createWorkOSClient } from '../../shared/workos-client.js';
import { enrollTotp } from '../../totp/enroller.js';
import { detectFormat } from '../../totp/parsers.js';
import { processRoleDefinitions, assignRolesToUsers } from '../../roles/processor.js';

export async function runPostImport(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 9: Post-Import Tasks\n'));

  // TOTP enrollment
  await handleTotp(state);
  if (state.cancelled) return state;

  // Role definitions
  await handleRoles(state);

  return state;
}

async function handleTotp(state: WizardState): Promise<void> {
  const totpResponse = await prompts({
    type: 'confirm',
    name: 'hasTotp',
    message: 'Do you have TOTP/MFA secrets to migrate?',
    initial: false,
  }, { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled || !totpResponse.hasTotp) return;

  const fileResponse = await prompts([
    {
      type: 'text',
      name: 'totpPath',
      message: 'Path to TOTP secrets file (CSV or NDJSON)',
      validate: (v: string) => fs.existsSync(v) || 'File not found',
    },
    {
      type: 'text',
      name: 'totpIssuer',
      message: 'TOTP issuer name (shown in authenticator apps)',
      initial: '',
    },
  ], { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled) return;

  state.totpFilePath = fileResponse.totpPath;
  state.totpIssuer = fileResponse.totpIssuer || undefined;

  const format = detectFormat(state.totpFilePath!);

  console.log(chalk.blue(`\n  Enrolling TOTP factors (${format} format)...\n`));

  try {
    const workos = createWorkOSClient();

    const { summary } = await enrollTotp(workos, {
      inputPath: state.totpFilePath!,
      format,
      concurrency: 5,
      rateLimit: 10,
      dryRun: false,
      totpIssuer: state.totpIssuer,
      quiet: false,
    });

    console.log(chalk.green('\n  TOTP Enrollment Summary'));
    console.log(`    Total: ${summary.total}`);
    console.log(`    Enrolled: ${summary.enrolled}`);
    console.log(`    Skipped: ${summary.skipped}`);
    if (summary.userNotFound > 0) {
      console.log(chalk.yellow(`    User not found: ${summary.userNotFound}`));
    }
    if (summary.failures > 0) {
      console.log(chalk.red(`    Failures: ${summary.failures}`));
    }
    console.log();
  } catch (err) {
    console.error(chalk.red(`  TOTP enrollment failed: ${(err as Error).message}\n`));
  }
}

async function handleRoles(state: WizardState): Promise<void> {
  const roleResponse = await prompts({
    type: 'confirm',
    name: 'hasRoles',
    message: 'Do you have role definitions to process?',
    initial: false,
  }, { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled || !roleResponse.hasRoles) return;

  const fileResponse = await prompts([
    {
      type: 'text',
      name: 'definitionsPath',
      message: 'Path to role definitions CSV',
      validate: (v: string) => fs.existsSync(v) || 'File not found',
    },
    {
      type: 'confirm',
      name: 'hasUserMapping',
      message: 'Do you also have a user-role mapping CSV?',
      initial: false,
    },
    {
      type: (prev: boolean) => prev ? 'text' : null,
      name: 'userMappingPath',
      message: 'Path to user-role mapping CSV',
      validate: (v: string) => fs.existsSync(v) || 'File not found',
    },
    {
      type: (_: unknown, values: Record<string, unknown>) => values.hasUserMapping ? 'text' : null,
      name: 'orgId',
      message: 'Organization ID for role assignments',
      validate: (v: string) => v.length > 0 || 'Required when using user-role mapping',
    },
  ], { onCancel: () => { state.cancelled = true; } });

  if (state.cancelled) return;

  state.roleDefinitionsPath = fileResponse.definitionsPath;
  state.roleUserMappingPath = fileResponse.userMappingPath;

  console.log(chalk.blue('\n  Processing role definitions...\n'));

  try {
    const summary = await processRoleDefinitions(fileResponse.definitionsPath, {
      dryRun: false,
    });

    console.log(chalk.green('  Role Processing Summary'));
    console.log(`    Total: ${summary.total}`);
    console.log(`    Created: ${summary.created}`);
    console.log(`    Already exist: ${summary.alreadyExist}`);
    if (summary.errors > 0) {
      console.log(chalk.red(`    Errors: ${summary.errors}`));
    }
    console.log();

    // Assign roles to users if mapping provided
    if (fileResponse.userMappingPath && fileResponse.orgId) {
      console.log(chalk.blue('  Assigning roles to users...\n'));

      const workos = createWorkOSClient();
      const assignResult = await assignRolesToUsers(
        fileResponse.userMappingPath,
        workos,
        { orgId: fileResponse.orgId, dryRun: false },
      );

      console.log(chalk.green('  Role Assignment Summary'));
      console.log(`    Total: ${assignResult.totalMappings}`);
      console.log(`    Assigned: ${assignResult.assigned}`);
      if (assignResult.userNotFound > 0) {
        console.log(chalk.yellow(`    User not found: ${assignResult.userNotFound}`));
      }
      if (assignResult.failures > 0) {
        console.log(chalk.red(`    Failures: ${assignResult.failures}`));
      }
      console.log();
    }
  } catch (err) {
    console.error(chalk.red(`  Role processing failed: ${(err as Error).message}\n`));
  }
}
