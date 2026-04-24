import { Command } from 'commander';
import chalk from 'chalk';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate a WorkOS migration CSV file')
    .requiredOption('--csv <path>', 'CSV file to validate')
    .option('--auto-fix', 'Automatically fix common issues')
    .option('--output <path>', 'Output fixed CSV (only with --auto-fix)')
    .option('--strict', 'Treat warnings as errors')
    .option('--quiet', 'Only show errors, not warnings')
    .action(async () => {
      console.log(chalk.yellow('Validate command not yet implemented. Coming in Phase 5.'));
    });
}
