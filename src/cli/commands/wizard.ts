import { Command } from 'commander';
import { MigrationWizard } from '../../wizard/wizard.js';

export function registerWizardCommand(program: Command): void {
  program
    .command('wizard')
    .description('Guided step-by-step migration wizard')
    .action(async () => {
      const wizard = new MigrationWizard();
      await wizard.run();
    });
}
