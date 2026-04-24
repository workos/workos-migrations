import { MigrationWizard } from '../../wizard/wizard.js';
export function registerWizardCommand(program) {
    program
        .command('wizard')
        .description('Guided step-by-step migration wizard')
        .action(async () => {
        const wizard = new MigrationWizard();
        await wizard.run();
    });
}
