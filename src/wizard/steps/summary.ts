import chalk from 'chalk';
import type { WizardState } from '../wizard.js';

export async function showSummary(state: WizardState): Promise<void> {
  console.log(chalk.cyan('\n  ' + '='.repeat(50)));
  console.log(chalk.cyan('  Migration Complete'));
  console.log(chalk.cyan('  ' + '='.repeat(50) + '\n'));

  console.log(chalk.bold('  Provider:   ') + (state.provider || 'unknown'));
  console.log(chalk.bold('  CSV:        ') + (state.csvFilePath || 'N/A'));

  if (state.validationPassed !== undefined) {
    console.log(chalk.bold('  Validation: ') + (state.validationPassed ? chalk.green('passed') : chalk.yellow('passed with warnings')));
  }

  if (state.fixesApplied && state.fixesApplied > 0) {
    console.log(chalk.bold('  Auto-fixes: ') + state.fixesApplied);
  }

  if (state.dryRun) {
    console.log(chalk.bold('  Import:     ') + chalk.yellow('dry-run only'));
  }

  if (state.totpFilePath) {
    console.log(chalk.bold('  TOTP:       ') + 'enrolled');
  }

  if (state.roleDefinitionsPath) {
    console.log(chalk.bold('  Roles:      ') + 'processed');
  }

  console.log(chalk.bold('\n  Next Steps:\n'));
  console.log(chalk.gray('  1. Review the WorkOS Dashboard to verify imported users'));

  if (state.errorsPath) {
    console.log(chalk.gray(`  2. Check ${state.errorsPath} for any import errors`));
    console.log(chalk.gray('  3. Run: workos-migrate analyze --errors errors.jsonl'));
  }

  if (state.dryRun) {
    console.log(chalk.gray('  4. Re-run without dry-run: workos-migrate import --csv ' + state.csvFilePath));
  }

  console.log(chalk.gray('\n  For help: workos-migrate --help\n'));
}
