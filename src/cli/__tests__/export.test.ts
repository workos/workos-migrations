import { Command } from 'commander';
import { registerExportCommand } from '../commands/export';
import { listSources } from '../../sources/registry';

function buildExportCommand(): Command {
  const program = new Command();
  registerExportCommand(program);
  const exportCmd = program.commands.find((c) => c.name() === 'export');
  if (!exportCmd) throw new Error('export command not registered');
  return exportCmd;
}

function longFlags(cmd: Command): string[] {
  return cmd.options.map((o) => o.long).filter((l): l is string => Boolean(l));
}

describe('registry-driven export command', () => {
  it('registers one subcommand per source in the registry', () => {
    const exportCmd = buildExportCommand();
    const subNames = exportCmd.commands.map((c) => c.name()).sort();
    const sourceIds = listSources()
      .map((s) => s.id)
      .sort();
    expect(subNames).toEqual(sourceIds);
  });

  it('generates --output-dir and a flag per credential + option for each source', () => {
    const exportCmd = buildExportCommand();
    for (const source of listSources()) {
      const sub = exportCmd.commands.find((c) => c.name() === source.id)!;
      const flags = longFlags(sub);

      expect(flags).toContain('--output-dir');
      expect(flags).toContain('--quiet');

      for (const cred of source.credentials) {
        expect(flags).toContain(`--${kebab(cred.key)}`);
      }
      for (const opt of source.options) {
        // The `input` option is surfaced as --from-file.
        const expected = opt.id === 'input' ? '--from-file' : `--${kebab(opt.id)}`;
        expect(flags).toContain(expected);
      }
    }
  });

  it('surfaces auth0 credentials and the file-source --from-file flag', () => {
    const exportCmd = buildExportCommand();
    const auth0 = exportCmd.commands.find((c) => c.name() === 'auth0')!;
    expect(longFlags(auth0)).toEqual(
      expect.arrayContaining(['--client-id', '--client-secret', '--domain']),
    );

    const clerk = exportCmd.commands.find((c) => c.name() === 'clerk')!;
    expect(longFlags(clerk)).toContain('--from-file');
    expect(longFlags(clerk)).toContain('--secret-key');
  });
});

function kebab(id: string): string {
  return id.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
