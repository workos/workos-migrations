import { Command } from 'commander';
import chalk from 'chalk';
import { listSources } from '../../sources/registry.js';
import type { MigrationSource, SourceOption } from '../../sources/types.js';

/**
 * Registry-driven `export <provider>` command. One subcommand per registered
 * source, with flags generated from each source's `credentials` + `OptionSchema`.
 * Adding a source to the registry surfaces it here with zero edits to this file.
 */
export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('Export a provider into a WorkOS migration package');

  for (const source of listSources()) {
    const sub = exportCmd
      .command(source.id)
      .description(`Export ${source.displayName} into a WorkOS migration package`);

    sub.requiredOption('--output-dir <dir>', 'Output directory for the migration package');
    sub.option('--quiet', 'Suppress progress output');

    for (const cred of source.credentials) {
      const flag = `--${kebab(cred.key)} <value>`;
      const envDefault = cred.envVar ? process.env[cred.envVar] : undefined;
      if (cred.required) {
        sub.requiredOption(flag, cred.name, envDefault);
      } else {
        sub.option(flag, cred.name, envDefault);
      }
    }

    for (const opt of source.options) {
      const desc = opt.description ?? opt.label;
      // A source's `input` option is the supplied export file → `--from-file`.
      if (opt.id === 'input') {
        if (opt.required) sub.requiredOption('--from-file <path>', desc);
        else sub.option('--from-file <path>', desc);
        continue;
      }
      if (opt.type === 'boolean') {
        sub.option(`--${kebab(opt.id)}`, desc);
      } else {
        sub.option(`--${kebab(opt.id)} <value>`, desc);
      }
    }

    sub.action(async (opts: Record<string, unknown>) => {
      try {
        await runExport(source, opts);
      } catch (error: unknown) {
        console.error(chalk.red(`\nExport failed: ${(error as Error).message}`));
        process.exit(1);
      }
    });
  }
}

async function runExport(source: MigrationSource, opts: Record<string, unknown>): Promise<void> {
  const credentials: Record<string, string> = {};
  for (const cred of source.credentials) {
    const value = opts[cred.key];
    if (value !== undefined && value !== null) credentials[cred.key] = String(value);
  }

  const options: Record<string, unknown> = {};
  for (const opt of source.options) {
    const flagKey = opt.id === 'input' ? 'fromFile' : opt.id;
    const coerced = coerce(opt, opts[flagKey]);
    if (coerced !== undefined) options[opt.id] = coerced;
  }

  const outputDir = String(opts.outputDir);
  const quiet = Boolean(opts.quiet ?? false);

  if (!quiet) {
    console.log(chalk.blue(`Exporting ${source.displayName} → ${outputDir}`));
  }

  const result = await source.export({ credentials, options, outputDir, quiet });

  if (!quiet) {
    console.log(chalk.green('\nExport complete'));
    console.log(chalk.gray(`  Package: ${result.outputDir}`));
    for (const [entity, count] of Object.entries(result.manifest.entitiesExported)) {
      if (typeof count === 'number' && count > 0) {
        console.log(chalk.gray(`  ${entity}: ${count}`));
      }
    }
  }
}

function coerce(opt: SourceOption, raw: unknown): unknown {
  const value = raw === undefined ? opt.default : raw;
  if (value === undefined) return undefined;

  switch (opt.type) {
    case 'boolean':
      return value === true || value === 'true';
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'string[]':
      return Array.isArray(value)
        ? value
        : String(value)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    default:
      return String(value);
  }
}

/** camelCase option/credential id → kebab-case CLI flag (clientId → client-id). */
function kebab(id: string): string {
  return id.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
