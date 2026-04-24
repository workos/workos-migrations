import prompts from 'prompts';
import chalk from 'chalk';
import type { WizardState } from '../wizard.js';
import { validateCsv } from '../../validator/validator.js';

export async function runValidation(state: WizardState): Promise<WizardState> {
  console.log(chalk.cyan('  Step 6: CSV Validation\n'));

  console.log(chalk.blue(`  Validating: ${state.csvFilePath}\n`));

  try {
    const result = await validateCsv({
      csvPath: state.csvFilePath!,
      autoFix: false,
      quiet: true,
    });

    // Show results
    console.log(`    Total rows: ${result.totalRows}`);
    console.log(`    Valid rows: ${result.validRows}`);

    if (result.errors.length > 0) {
      console.log(chalk.red(`    Errors: ${result.errors.length}`));
      for (const err of result.errors.slice(0, 5)) {
        const loc = err.row ? `Row ${err.row}` : '';
        console.log(chalk.red(`      ${loc}: ${err.message}`));
      }
      if (result.errors.length > 5) {
        console.log(chalk.red(`      ... and ${result.errors.length - 5} more`));
      }
    }

    if (result.warnings.length > 0) {
      console.log(chalk.yellow(`    Warnings: ${result.warnings.length}`));
    }

    if (result.duplicateEmails.length > 0) {
      console.log(chalk.yellow(`    Duplicate emails: ${result.duplicateEmails.length}`));
    }

    console.log();

    if (!result.valid) {
      // Offer auto-fix
      const fixResponse = await prompts({
        type: 'confirm',
        name: 'autoFix',
        message: 'Validation found errors. Attempt auto-fix?',
        initial: true,
      }, { onCancel: () => { state.cancelled = true; } });

      if (state.cancelled) return state;

      if (fixResponse.autoFix) {
        const fixedPath = state.csvFilePath!.replace('.csv', '-fixed.csv');
        console.log(chalk.blue('\n  Applying auto-fixes...'));

        const fixedResult = await validateCsv({
          csvPath: state.csvFilePath!,
          autoFix: true,
          outputPath: fixedPath,
          quiet: true,
        });

        if (fixedResult.fixesApplied && fixedResult.fixesApplied > 0) {
          console.log(chalk.green(`  Applied ${fixedResult.fixesApplied} fixes`));
          state.csvFilePath = fixedPath;
          state.fixesApplied = fixedResult.fixesApplied;
        }

        // Re-validate
        const revalidated = await validateCsv({
          csvPath: state.csvFilePath!,
          quiet: true,
        });

        if (revalidated.valid) {
          console.log(chalk.green('  CSV is now valid.\n'));
          state.validationPassed = true;
        } else {
          console.log(chalk.yellow(`  Still ${revalidated.errors.length} errors remaining.`));
          const continueResponse = await prompts({
            type: 'confirm',
            name: 'proceed',
            message: 'Continue anyway?',
            initial: false,
          }, { onCancel: () => { state.cancelled = true; } });

          if (state.cancelled) return state;
          if (!continueResponse.proceed) {
            state.cancelled = true;
            return state;
          }
          state.validationPassed = false;
        }
      } else {
        const continueResponse = await prompts({
          type: 'confirm',
          name: 'proceed',
          message: 'Continue with invalid CSV?',
          initial: false,
        }, { onCancel: () => { state.cancelled = true; } });

        if (state.cancelled) return state;
        if (!continueResponse.proceed) {
          state.cancelled = true;
          return state;
        }
        state.validationPassed = false;
      }
    } else {
      console.log(chalk.green('  CSV is valid.\n'));
      state.validationPassed = true;
    }
  } catch (err) {
    console.error(chalk.red(`\n  Validation failed: ${(err as Error).message}`));
    const continueResponse = await prompts({
      type: 'confirm',
      name: 'proceed',
      message: 'Continue without validation?',
      initial: false,
    }, { onCancel: () => { state.cancelled = true; } });

    if (state.cancelled) return state;
    if (!continueResponse.proceed) {
      state.cancelled = true;
    }
  }

  return state;
}
