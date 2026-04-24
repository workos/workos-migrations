import { Command } from 'commander';
import chalk from 'chalk';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import users from CSV into WorkOS')
    .requiredOption('--csv <path>', 'Path to CSV file')
    .option('--concurrency <n>', 'Concurrent API requests', '10')
    .option('--rate-limit <n>', 'Max requests per second', '50')
    .option('--workers <n>', 'Number of worker threads', '1')
    .option('--chunk-size <n>', 'Rows per chunk', '1000')
    .option('--job-id <id>', 'Job ID for checkpoint/resume')
    .option('--resume [jobId]', 'Resume from checkpoint')
    .option('--dry-run', 'Validate and plan without importing')
    .option('--plan', 'Show import plan without executing')
    .option('--org-id <id>', 'WorkOS organization ID for single-org mode')
    .option('--org-external-id <id>', 'External org ID for single-org mode')
    .option('--create-org-if-missing', 'Auto-create orgs not found in WorkOS')
    .option('--dedupe', 'Deduplicate rows by email')
    .option('--errors <path>', 'Error output file path', 'errors.jsonl')
    .option('--quiet', 'Suppress progress output')
    .action(async () => {
      console.log(chalk.yellow('Import command not yet implemented. Coming in Phase 2.'));
    });
}
