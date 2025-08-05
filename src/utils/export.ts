import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { ExportResult } from '../types';

export function saveExportResult(result: ExportResult): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${result.provider}-export-${timestamp}.json`;
  const filepath = path.join(process.cwd(), filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));

  console.log(chalk.green(`\n✅ Export completed successfully!`));
  console.log(chalk.blue(`📁 Report saved to: ${filepath}`));
  console.log(chalk.gray(`\n📊 Summary:`));
  
  Object.entries(result.summary).forEach(([entityType, count]) => {
    console.log(chalk.gray(`   • ${entityType}: ${count}`));
  });

  return filepath;
}

export function displayExportSummary(result: ExportResult): void {
  console.log(chalk.green(`\n✅ Export completed successfully!`));
  console.log(chalk.gray(`\n📊 Summary:`));
  
  Object.entries(result.summary).forEach(([entityType, count]) => {
    console.log(chalk.gray(`   • ${entityType}: ${count}`));
  });
}