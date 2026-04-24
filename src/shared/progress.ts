import cliProgress from 'cli-progress';
import chalk from 'chalk';
import type { ImportSummary, ProgressStats } from './types.js';

export function createProgressBar(total: number, label: string = 'Progress'): cliProgress.SingleBar {
  return new cliProgress.SingleBar(
    {
      format: `${label} |${chalk.cyan('{bar}')}| {percentage}% | {value}/{total} | ETA: {eta_formatted}`,
      hideCursor: true,
      clearOnComplete: false,
    },
    cliProgress.Presets.shades_classic,
  );
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

export function printImportSummary(summary: ImportSummary): void {
  const line = '═'.repeat(55);
  console.log(`\n${line}`);
  console.log('  Import Summary');
  console.log(line);
  console.log(`  Total rows:             ${summary.totalRows}`);
  console.log(`  Users created:          ${chalk.green(summary.usersCreated)}`);
  console.log(`  Memberships created:    ${chalk.green(summary.membershipsCreated)}`);
  console.log(`  Roles assigned:         ${chalk.green(summary.rolesAssigned)}`);
  if (summary.duplicateUsers > 0) {
    console.log(`  Duplicate users:        ${chalk.yellow(summary.duplicateUsers)}`);
  }
  if (summary.duplicateMemberships > 0) {
    console.log(`  Duplicate memberships:  ${chalk.yellow(summary.duplicateMemberships)}`);
  }
  if (summary.errors > 0) {
    console.log(`  Errors:                 ${chalk.red(summary.errors)}`);
  }
  if (summary.roleAssignmentFailures > 0) {
    console.log(`  Role failures:          ${chalk.red(summary.roleAssignmentFailures)}`);
  }
  console.log(`  Duration:               ${formatDuration(summary.duration)}`);

  if (summary.cacheStats) {
    console.log(`  Org cache hit rate:     ${summary.cacheStats.hitRate}`);
  }

  if (summary.warnings.length > 0) {
    console.log(chalk.yellow('\n  Warnings:'));
    for (const warning of summary.warnings) {
      console.log(chalk.yellow(`    - ${warning}`));
    }
  }

  console.log(line);
}

export function printProgressUpdate(stats: ProgressStats, quiet: boolean): void {
  if (quiet) return;
  const rate = stats.rate > 0 ? `${stats.rate.toFixed(1)} rows/sec` : '...';
  process.stdout.write(
    `\r  ${stats.processed}/${stats.total} processed | ${chalk.green(stats.successes)} ok | ${chalk.red(stats.failures)} errors | ${rate}`,
  );
}
