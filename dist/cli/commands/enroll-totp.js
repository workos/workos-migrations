import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { createWorkOSClient } from '../../shared/workos-client.js';
import { enrollTotp } from '../../totp/enroller.js';
import { detectFormat } from '../../totp/parsers.js';
export function registerEnrollTotpCommand(program) {
    program
        .command('enroll-totp')
        .description('Enroll TOTP MFA factors for imported users')
        .requiredOption('--input <path>', 'CSV or NDJSON file with email and TOTP secrets')
        .option('--format <format>', 'Input format: csv or ndjson (default: auto-detect)')
        .option('--concurrency <n>', 'Concurrent API requests', '5')
        .option('--rate-limit <n>', 'Max requests per second', '10')
        .option('--errors <path>', 'Error output file', 'totp-errors.jsonl')
        .option('--totp-issuer <name>', 'Issuer name shown in authenticator apps')
        .option('--dry-run', 'Validate input without enrolling')
        .option('--quiet', 'Suppress progress output')
        .action(async (opts) => {
        try {
            const inputPath = path.resolve(opts.input);
            if (!fs.existsSync(inputPath)) {
                console.error(chalk.red(`Input file not found: ${inputPath}`));
                process.exit(1);
            }
            // Resolve format
            let format;
            if (opts.format) {
                if (opts.format !== 'csv' && opts.format !== 'ndjson') {
                    console.error(chalk.red('--format must be csv or ndjson'));
                    process.exit(1);
                }
                format = opts.format;
            }
            else {
                format = detectFormat(inputPath);
            }
            const concurrency = parseInt(opts.concurrency, 10);
            const rateLimit = parseInt(opts.rateLimit, 10);
            if (!opts.quiet) {
                console.log(chalk.blue('WorkOS TOTP Enrollment'));
                console.log(`  Input: ${inputPath} (${format})`);
                console.log(`  Concurrency: ${concurrency}`);
                console.log(`  Rate limit: ${rateLimit} req/s`);
                if (opts.dryRun)
                    console.log(chalk.yellow('  Mode: DRY RUN'));
                console.log();
            }
            const workos = opts.dryRun ? createWorkOSClient('dry-run-key') : createWorkOSClient();
            const { summary } = await enrollTotp(workos, {
                inputPath,
                format,
                concurrency,
                rateLimit,
                dryRun: opts.dryRun || false,
                errorsPath: opts.errors,
                totpIssuer: opts.totpIssuer,
                quiet: opts.quiet || false,
            });
            if (!opts.quiet) {
                console.log(chalk.blue('\nTOTP Enrollment Summary'));
                console.log(`  Total records: ${summary.total}`);
                console.log(chalk.green(`  Enrolled: ${summary.enrolled}`));
                console.log(`  Skipped (already enrolled): ${summary.skipped}`);
                if (summary.userNotFound > 0) {
                    console.log(chalk.yellow(`  User not found: ${summary.userNotFound}`));
                }
                if (summary.failures > 0) {
                    console.log(chalk.red(`  Failures: ${summary.failures}`));
                }
                console.log(`  Duration: ${summary.duration}ms`);
            }
            if (summary.failures > 0) {
                process.exit(1);
            }
        }
        catch (error) {
            console.error(chalk.red(`\nTOTP enrollment failed: ${error.message}`));
            process.exit(1);
        }
    });
}
