import prompts from 'prompts';
import chalk from 'chalk';
import { createWorkOSClient } from '../../shared/workos-client.js';
import { countCSVRows } from '../../shared/csv-utils.js';
import { runImport } from '../../import/importer.js';
import { CheckpointManager, calculateCsvHash } from '../../import/checkpoint.js';
export async function runImportStep(state) {
    console.log(chalk.cyan('  Step 8: Import\n'));
    // Show import plan
    const totalRows = await countCSVRows(state.csvFilePath);
    console.log(chalk.blue('  Import Plan'));
    console.log(`    CSV file:      ${state.csvFilePath}`);
    console.log(`    Total rows:    ${totalRows}`);
    console.log(`    Concurrency:   ${state.concurrency}`);
    console.log(`    Rate limit:    ${state.rateLimit} req/s`);
    if (state.orgId)
        console.log(`    Org ID:        ${state.orgId}`);
    if (state.orgExternalId)
        console.log(`    Org External:  ${state.orgExternalId}`);
    if (state.dryRun)
        console.log(chalk.yellow('    Mode:          DRY RUN'));
    console.log();
    // Confirm
    const confirm = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: state.dryRun ? 'Start dry-run import?' : 'Start importing users to WorkOS?',
        initial: true,
    }, {
        onCancel: () => {
            state.cancelled = true;
        },
    });
    if (state.cancelled)
        return state;
    if (!confirm.proceed) {
        state.cancelled = true;
        return state;
    }
    try {
        const workos = state.dryRun ? createWorkOSClient('dry-run-key') : createWorkOSClient();
        // Create checkpoint
        const csvHash = await calculateCsvHash(state.csvFilePath);
        const checkpointManager = await CheckpointManager.create({
            jobId: state.jobId,
            csvPath: state.csvFilePath,
            csvHash,
            totalRows,
            chunkSize: 1000,
            concurrency: state.concurrency,
            mode: state.orgId || state.orgExternalId ? 'single-org' : 'multi-org',
            orgId: state.orgId,
        });
        await runImport({
            workos,
            csvPath: state.csvFilePath,
            concurrency: state.concurrency,
            rateLimit: state.rateLimit,
            orgId: state.orgId || state.orgExternalId || null,
            createOrgIfMissing: state.createOrgIfMissing || false,
            dryRun: state.dryRun || false,
            dedupe: false,
            errorsPath: state.errorsPath,
            quiet: false,
            checkpointManager,
            numWorkers: state.workers || 1,
        });
        console.log(chalk.green('\n  Import complete.\n'));
        // If it was a dry-run, ask to run for real
        if (state.dryRun) {
            const realRun = await prompts({
                type: 'confirm',
                name: 'proceed',
                message: 'Dry-run complete. Run the actual import now?',
                initial: true,
            }, {
                onCancel: () => {
                    state.cancelled = true;
                },
            });
            if (state.cancelled)
                return state;
            if (realRun.proceed) {
                state.dryRun = false;
                state.jobId = `wizard-${Date.now()}`;
                const realWorkos = createWorkOSClient();
                const realCsvHash = await calculateCsvHash(state.csvFilePath);
                const realCheckpoint = await CheckpointManager.create({
                    jobId: state.jobId,
                    csvPath: state.csvFilePath,
                    csvHash: realCsvHash,
                    totalRows,
                    chunkSize: 1000,
                    concurrency: state.concurrency,
                    mode: state.orgId || state.orgExternalId ? 'single-org' : 'multi-org',
                    orgId: state.orgId,
                });
                console.log(chalk.blue('\n  Running import...\n'));
                await runImport({
                    workos: realWorkos,
                    csvPath: state.csvFilePath,
                    concurrency: state.concurrency,
                    rateLimit: state.rateLimit,
                    orgId: state.orgId || state.orgExternalId || null,
                    createOrgIfMissing: state.createOrgIfMissing || false,
                    dryRun: false,
                    dedupe: false,
                    errorsPath: state.errorsPath,
                    quiet: false,
                    checkpointManager: realCheckpoint,
                    numWorkers: state.workers || 1,
                });
                console.log(chalk.green('\n  Import complete.\n'));
            }
        }
    }
    catch (err) {
        console.error(chalk.red(`\n  Import failed: ${err.message}`));
        console.log(chalk.gray(`  You can retry with: workos-migrate import --csv ${state.csvFilePath} --resume\n`));
    }
    return state;
}
