import { Command } from 'commander';
import { registerImportCommand } from './commands/import.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerExportAuth0Command } from './commands/export-auth0.js';
const program = new Command();
program
    .name('workos-migrate')
    .description('WorkOS Migration Tool — migrate users from identity providers to WorkOS')
    .version('2.0.0');
registerImportCommand(program);
registerValidateCommand(program);
registerExportAuth0Command(program);
export { program };
