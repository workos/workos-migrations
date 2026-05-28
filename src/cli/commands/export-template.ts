import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  getAllTemplates,
  getTemplate,
  generateTemplateExample,
} from '../../providers/csv/index.js';

export function registerExportTemplateCommand(program: Command): void {
  program
    .command('export-template')
    .description('Export a blank CSV template with headers and example rows')
    .argument(
      '[template]',
      'Template name (users, organizations, organization_memberships, saml_connections, oidc_connections)',
    )
    .option('--output <file>', 'Output file path (defaults to stdout)')
    .option('--list', 'List all available templates')
    .option('--no-examples', 'Output only the header row without example data rows')
    .action(
      async (
        templateName: string | undefined,
        opts: { output?: string; list?: boolean; examples?: boolean },
      ) => {
        if (opts.list) {
          listTemplates();
          return;
        }

        if (!templateName) {
          console.error(chalk.red('Error: template name is required.'));
          console.log();
          listTemplates();
          process.exit(1);
        }

        const template = getTemplate(templateName);
        if (!template) {
          console.error(chalk.red(`Error: unknown template "${templateName}".`));
          console.log();
          listTemplates();
          process.exit(1);
        }

        let content: string;
        if (opts.examples === false) {
          content = template.headers.join(',') + '\n';
        } else {
          content = generateTemplateExample(templateName) + '\n';
        }

        if (opts.output) {
          const outputPath = path.resolve(opts.output);
          const dir = path.dirname(outputPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(outputPath, content, 'utf-8');
          console.log(chalk.green(`Template written to ${outputPath}`));
          console.log(
            chalk.gray(`  ${template.headers.length} columns: ${template.headers.join(', ')}`),
          );
          console.log(chalk.gray(`  Required: ${template.required.join(', ')}`));
          if (template.optional.length > 0) {
            console.log(chalk.gray(`  Optional: ${template.optional.join(', ')}`));
          }
        } else {
          process.stdout.write(content);
        }
      },
    );
}

function listTemplates(): void {
  const templates = getAllTemplates();
  console.log(chalk.cyan('Available CSV templates:\n'));
  for (const t of templates) {
    console.log(
      `  ${chalk.bold(t.name.toLowerCase().replace(/ /g, '_'))}  ${chalk.gray(t.description)}`,
    );
    console.log(chalk.gray(`    File: ${t.filename}  |  Columns: ${t.headers.join(', ')}`));
    console.log(chalk.gray(`    Required: ${t.required.join(', ')}`));
    console.log();
  }
  console.log(chalk.gray('Usage: workos-migrate export-template <name> [--output file.csv]'));
}
