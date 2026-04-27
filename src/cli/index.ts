import { Command } from 'commander';
import { registerImportCommand } from './commands/import.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerExportAuth0Command } from './commands/export-auth0.js';
import { registerExportCognitoCommand } from './commands/export-cognito.js';
import { registerMergePasswordsCommand } from './commands/merge-passwords.js';
import { registerTransformClerkCommand } from './commands/transform-clerk.js';
import { registerTransformFirebaseCommand } from './commands/transform-firebase.js';
import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerEnrollTotpCommand } from './commands/enroll-totp.js';
import { registerProcessRolesCommand } from './commands/process-roles.js';
import { registerWizardCommand } from './commands/wizard.js';

const program = new Command();

program
  .name('workos-migrate')
  .description('WorkOS Migration Tool — migrate users from identity providers to WorkOS')
  .version('2.0.0');

registerImportCommand(program);
registerValidateCommand(program);
registerExportAuth0Command(program);
registerExportCognitoCommand(program);
registerMergePasswordsCommand(program);
registerTransformClerkCommand(program);
registerTransformFirebaseCommand(program);
registerAnalyzeCommand(program);
registerEnrollTotpCommand(program);
registerProcessRolesCommand(program);
registerWizardCommand(program);

export { program };
