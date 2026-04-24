import fs from 'node:fs';
import { Command } from 'commander';
import chalk from 'chalk';
import { createWorkOSClient } from '../../shared/workos-client.js';
import { countCSVRows } from '../../shared/csv-utils.js';
import * as logger from '../../shared/logger.js';
import { runImport } from '../../import/importer.js';
import { CheckpointManager, calculateCsvHash, findLastJob } from '../../import/checkpoint.js';

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
    .action(async (opts) => {
      try {
        // Validate CSV exists
        if (!fs.existsSync(opts.csv)) {
          logger.error(`CSV file not found: ${opts.csv}`);
          process.exit(1);
        }

        const concurrency = parseInt(opts.concurrency, 10);
        const rateLimit = parseInt(opts.rateLimit, 10);
        const workers = parseInt(opts.workers, 10);
        const chunkSize = parseInt(opts.chunkSize, 10);

        // Validate worker flag requires checkpoint
        if (workers > 1 && !opts.jobId && opts.resume === undefined) {
          logger.error('--workers > 1 requires --job-id or --resume for checkpoint support');
          process.exit(1);
        }

        // Plan mode: show what would happen
        if (opts.plan) {
          const totalRows = await countCSVRows(opts.csv);
          const totalChunks = Math.ceil(totalRows / chunkSize);
          console.log(chalk.cyan('\n  Import Plan'));
          console.log(chalk.cyan('  ' + '═'.repeat(40)));
          console.log(`  CSV file:        ${opts.csv}`);
          console.log(`  Total rows:      ${totalRows}`);
          console.log(`  Concurrency:     ${concurrency}`);
          console.log(`  Rate limit:      ${rateLimit} req/s`);
          console.log(`  Workers:         ${workers}`);
          console.log(`  Chunk size:      ${chunkSize}`);
          console.log(`  Total chunks:    ${totalChunks}`);
          if (opts.orgId) console.log(`  Org ID:          ${opts.orgId}`);
          if (opts.orgExternalId) console.log(`  Org External ID: ${opts.orgExternalId}`);
          if (opts.dryRun) console.log(`  Mode:            ${chalk.yellow('DRY RUN')}`);
          console.log(chalk.cyan('  ' + '═'.repeat(40)));
          return;
        }

        // Initialize WorkOS client (not needed for dry-run)
        const workos = opts.dryRun ? createWorkOSClient('dry-run-key') : createWorkOSClient();

        // Handle checkpoint
        let checkpointManager: CheckpointManager | undefined;

        if (opts.resume !== undefined) {
          // Resume mode
          const jobId =
            typeof opts.resume === 'string' && opts.resume !== ''
              ? opts.resume
              : opts.jobId || (await findLastJob());

          if (!jobId) {
            logger.error('No job ID found to resume. Use --resume <jobId> or --job-id <id>.');
            process.exit(1);
          }

          const exists = await CheckpointManager.exists(jobId);
          if (!exists) {
            logger.error(`No checkpoint found for job: ${jobId}`);
            process.exit(1);
          }

          checkpointManager = await CheckpointManager.resume(jobId);
          const state = checkpointManager.getState();
          const progress = checkpointManager.getProgress();

          if (!opts.quiet) {
            logger.info(`Resuming job ${jobId}: ${progress.completedChunks}/${progress.totalChunks} chunks complete`);
          }

          // Validate CSV hash
          const currentHash = await calculateCsvHash(opts.csv);
          if (currentHash !== state.csvHash) {
            logger.warn('CSV file has changed since checkpoint was created. Results may be inconsistent.');
          }
        } else if (opts.jobId) {
          // New job with checkpointing
          const totalRows = await countCSVRows(opts.csv);
          const csvHash = await calculateCsvHash(opts.csv);

          // Detect mode from CSV headers
          const firstRow = await getFirstRowHeaders(opts.csv);
          const hasOrgColumns = firstRow.some(
            (h) => h === 'org_id' || h === 'org_external_id' || h === 'org_name',
          );

          let mode: 'single-org' | 'multi-org' | 'user-only';
          if (opts.orgId || opts.orgExternalId) {
            mode = 'single-org';
          } else if (hasOrgColumns) {
            mode = 'multi-org';
          } else {
            mode = 'user-only';
          }

          checkpointManager = await CheckpointManager.create({
            jobId: opts.jobId,
            csvPath: opts.csv,
            csvHash,
            totalRows,
            chunkSize,
            concurrency,
            mode,
            orgId: opts.orgId,
          });

          if (!opts.quiet) {
            const totalChunks = Math.ceil(totalRows / chunkSize);
            logger.info(`Created checkpoint for job ${opts.jobId}: ${totalRows} rows, ${totalChunks} chunks`);
          }
        }

        // Run import
        await runImport({
          workos,
          csvPath: opts.csv,
          concurrency,
          rateLimit,
          orgId: opts.orgId || opts.orgExternalId || null,
          createOrgIfMissing: opts.createOrgIfMissing || false,
          dryRun: opts.dryRun || false,
          dedupe: opts.dedupe || false,
          errorsPath: opts.errors,
          quiet: opts.quiet || false,
          checkpointManager,
          numWorkers: workers,
        });
      } catch (err: any) {
        logger.error(err.message || 'Import failed');
        process.exit(1);
      }
    });
}

async function getFirstRowHeaders(csvPath: string): Promise<string[]> {
  const { parse } = await import('csv-parse');
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(csvPath);
    const parser = parse({ columns: true, bom: true, skip_empty_lines: true, trim: true });
    parser.on('readable', () => {
      const row = parser.read();
      if (row) {
        resolve(Object.keys(row));
        parser.destroy();
        input.destroy();
      }
    });
    parser.on('error', reject);
    parser.on('end', () => resolve([]));
    input.pipe(parser);
  });
}
