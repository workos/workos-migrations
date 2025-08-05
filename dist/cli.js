"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLI = void 0;
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const providers_1 = require("./providers");
const auth0_1 = require("./providers/auth0");
const csv_1 = require("./providers/csv");
const templates_1 = require("./providers/csv/templates");
const config_1 = require("./utils/config");
const export_1 = require("./utils/export");
const feature_request_1 = require("./utils/feature-request");
class CLI {
    async run() {
        console.log(chalk_1.default.blue.bold('\n🔄 WorkOS Migration Tool\n'));
        try {
            const provider = await this.selectProvider();
            const action = await this.selectAction();
            if (action === 'export') {
                await this.handleExport(provider.name);
            }
            else if (action === 'import') {
                await this.handleImport(provider.name);
            }
        }
        catch (error) {
            console.error(chalk_1.default.red('❌ Error:'), error instanceof Error ? error.message : 'Unknown error');
            process.exit(1);
        }
    }
    async selectProvider() {
        const providers = (0, providers_1.getAllProviders)();
        const { providerName } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'providerName',
                message: 'Select the identity provider:',
                choices: providers.map(provider => ({
                    name: provider.displayName,
                    value: provider.name,
                })),
            },
        ]);
        return (0, providers_1.getProvider)(providerName);
    }
    async selectAction() {
        const { action } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: 'Export data from provider', value: 'export' },
                    { name: 'Import data to WorkOS', value: 'import' },
                    { name: 'Exit', value: 'exit' },
                ],
            },
        ]);
        if (action === 'exit') {
            console.log(chalk_1.default.gray('Goodbye! 👋'));
            process.exit(0);
        }
        return action;
    }
    async handleExport(providerName) {
        const provider = (0, providers_1.getProvider)(providerName);
        if (providerName !== 'auth0') {
            await (0, feature_request_1.recordFeatureRequest)(providerName, 'export');
            return;
        }
        const credentials = await this.getCredentials(provider);
        const client = new auth0_1.Auth0Client(credentials);
        console.log(chalk_1.default.blue('\n📡 Connecting to Auth0...'));
        await client.authenticate();
        console.log(chalk_1.default.green('✓ Successfully authenticated with Auth0'));
        // Show available scopes
        const scopes = client.getScopes();
        if (scopes.length > 0) {
            console.log(chalk_1.default.blue('\n🔐 Available scopes:'));
            scopes.forEach(scope => {
                console.log(chalk_1.default.gray(`   • ${scope}`));
            });
        }
        const availableEntities = await client.getAvailableEntities();
        const selectedEntities = await this.selectEntities(availableEntities);
        if (selectedEntities.length === 0) {
            console.log(chalk_1.default.yellow('No entities selected for export.'));
            return;
        }
        console.log(chalk_1.default.blue('\n📥 Exporting data...'));
        const result = await client.exportEntities(selectedEntities);
        (0, export_1.saveExportResult)(result);
    }
    async handleImport(providerName) {
        if (providerName !== 'csv') {
            await (0, feature_request_1.recordFeatureRequest)(providerName, 'import');
            return;
        }
        const provider = (0, providers_1.getProvider)(providerName);
        const credentials = await this.getCredentials(provider);
        const client = new csv_1.CSVClient(credentials);
        console.log(chalk_1.default.blue('\n🔑 Validating WorkOS API key...'));
        await client.authenticate();
        console.log(chalk_1.default.green('✓ Successfully authenticated with WorkOS'));
        const action = await this.selectCSVAction();
        if (action === 'generate-template') {
            await this.handleGenerateTemplate(client);
        }
        else if (action === 'import-csv') {
            await this.handleCSVImport(client);
        }
        else if (action === 'validate-csv') {
            await this.handleCSVValidation(client);
        }
        else if (action === 'list-jobs') {
            await this.handleListJobs(client);
        }
    }
    async selectCSVAction() {
        const { action } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'What would you like to do?',
                choices: [
                    { name: 'Generate CSV template', value: 'generate-template' },
                    { name: 'Import CSV to WorkOS', value: 'import-csv' },
                    { name: 'Validate CSV file', value: 'validate-csv' },
                    { name: 'List import jobs', value: 'list-jobs' },
                ],
            },
        ]);
        return action;
    }
    async handleGenerateTemplate(client) {
        const templates = (0, csv_1.getAllTemplates)();
        const { templateType } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'templateType',
                message: 'Select template type:',
                choices: templates.map(template => ({
                    name: `${template.name} - ${template.description}`,
                    value: Object.keys(templates_1.CSV_TEMPLATES).find(key => templates_1.CSV_TEMPLATES[key] === template),
                })),
            },
        ]);
        const { outputPath } = await inquirer_1.default.prompt([
            {
                type: 'input',
                name: 'outputPath',
                message: 'Output file path (leave empty for default):',
            },
        ]);
        try {
            const filename = client.generateTemplate(templateType, outputPath || undefined);
            console.log(chalk_1.default.green(`✅ Template generated: ${filename}`));
            const templateInfo = client.getTemplateInfo(templateType);
            console.log(chalk_1.default.blue('\n📋 Template Schema:'));
            console.log(chalk_1.default.gray(`   Required columns: ${templateInfo.required_columns.join(', ')}`));
            if (templateInfo.optional_columns.length > 0) {
                console.log(chalk_1.default.gray(`   Optional columns: ${templateInfo.optional_columns.join(', ')}`));
            }
        }
        catch (error) {
            console.error(chalk_1.default.red('❌ Failed to generate template:'), error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async handleCSVImport(client) {
        const { csvFilePath } = await inquirer_1.default.prompt([
            {
                type: 'input',
                name: 'csvFilePath',
                message: 'Enter CSV file path:',
                validate: (input) => input.length > 0 || 'CSV file path is required',
            },
        ]);
        const templates = (0, csv_1.getAllTemplates)();
        const { templateType } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'templateType',
                message: 'Select template type:',
                choices: templates.map(template => ({
                    name: `${template.name} - ${template.description}`,
                    value: Object.keys(templates_1.CSV_TEMPLATES).find(key => templates_1.CSV_TEMPLATES[key] === template),
                })),
            },
        ]);
        try {
            const result = await client.importCSV({
                csvFilePath,
                templateType,
            });
            if (result.success) {
                console.log(chalk_1.default.green(`✅ ${result.message}`));
                if (result.jobId) {
                    console.log(chalk_1.default.blue(`📋 Job ID: ${result.jobId}`));
                    console.log(chalk_1.default.gray('You can check the status with the "List import jobs" option.'));
                }
            }
            else {
                console.error(chalk_1.default.red(`❌ ${result.message}`));
                if (result.validationResult && result.validationResult.errors.length > 0) {
                    console.log(chalk_1.default.red('\nValidation errors:'));
                    result.validationResult.errors.forEach((error) => {
                        console.log(chalk_1.default.red(`   • ${error}`));
                    });
                }
            }
        }
        catch (error) {
            console.error(chalk_1.default.red('❌ Import failed:'), error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async handleCSVValidation(client) {
        const { csvFilePath } = await inquirer_1.default.prompt([
            {
                type: 'input',
                name: 'csvFilePath',
                message: 'Enter CSV file path:',
                validate: (input) => input.length > 0 || 'CSV file path is required',
            },
        ]);
        const templates = (0, csv_1.getAllTemplates)();
        const { templateType } = await inquirer_1.default.prompt([
            {
                type: 'list',
                name: 'templateType',
                message: 'Select template type:',
                choices: templates.map(template => ({
                    name: `${template.name} - ${template.description}`,
                    value: Object.keys(templates_1.CSV_TEMPLATES).find(key => templates_1.CSV_TEMPLATES[key] === template),
                })),
            },
        ]);
        try {
            const result = await client.importCSV({
                csvFilePath,
                templateType,
                validateOnly: true,
            });
            if (result.success) {
                console.log(chalk_1.default.green('✅ CSV validation passed'));
                if (result.validationResult) {
                    console.log(chalk_1.default.blue(`📊 ${result.validationResult.validRows}/${result.validationResult.totalRows} rows are valid`));
                    if (result.validationResult.warnings.length > 0) {
                        console.log(chalk_1.default.yellow('\n⚠️  Warnings:'));
                        result.validationResult.warnings.forEach((warning) => {
                            console.log(chalk_1.default.yellow(`   • ${warning}`));
                        });
                    }
                }
            }
            else {
                console.error(chalk_1.default.red('❌ CSV validation failed'));
                if (result.validationResult && result.validationResult.errors.length > 0) {
                    console.log(chalk_1.default.red('\nValidation errors:'));
                    result.validationResult.errors.forEach((error) => {
                        console.log(chalk_1.default.red(`   • ${error}`));
                    });
                }
            }
        }
        catch (error) {
            console.error(chalk_1.default.red('❌ Validation failed:'), error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async handleListJobs(client) {
        try {
            const jobs = await client.listImportJobs();
            if (jobs.length === 0) {
                console.log(chalk_1.default.gray('No import jobs found.'));
                return;
            }
            console.log(chalk_1.default.blue('\n📋 Import Jobs:'));
            jobs.forEach(job => {
                const statusColor = job.status === 'completed' ? 'green' :
                    job.status === 'failed' ? 'red' : 'yellow';
                console.log(chalk_1.default.gray(`   • ${job.jobId} - ${chalk_1.default[statusColor](job.status)} - ${job.message}`));
            });
        }
        catch (error) {
            console.error(chalk_1.default.red('❌ Failed to list jobs:'), error instanceof Error ? error.message : 'Unknown error');
        }
    }
    async getCredentials(provider) {
        const savedCredentials = (0, config_1.getProviderCredentials)(provider.name);
        const credentials = {};
        // Check environment variables and saved credentials
        let hasAllCredentials = true;
        for (const field of provider.credentials) {
            const envValue = field.envVar ? process.env[field.envVar] : undefined;
            const savedValue = savedCredentials[field.key];
            if (envValue) {
                credentials[field.key] = envValue;
            }
            else if (savedValue) {
                credentials[field.key] = savedValue;
            }
            else if (field.required) {
                hasAllCredentials = false;
            }
        }
        if (hasAllCredentials) {
            console.log(chalk_1.default.green(`✓ Using ${provider.displayName} credentials from environment/config`));
            return credentials;
        }
        console.log(chalk_1.default.yellow(`${provider.displayName} credentials not found or incomplete.`));
        console.log(chalk_1.default.gray('Please provide them below:\n'));
        const questions = provider.credentials
            .filter((field) => !credentials[field.key])
            .map((field) => ({
            type: field.type,
            name: field.key,
            message: `Enter ${field.name}:`,
            validate: (input) => field.required && input.length === 0
                ? `${field.name} is required`
                : true,
            mask: field.type === 'password' ? '*' : undefined,
        }));
        const answers = await inquirer_1.default.prompt(questions);
        const finalCredentials = { ...credentials, ...answers };
        // Ask if they want to save credentials
        const { saveCredentials } = await inquirer_1.default.prompt([
            {
                type: 'confirm',
                name: 'saveCredentials',
                message: 'Save credentials to config file for future use?',
                default: false,
            },
        ]);
        if (saveCredentials) {
            (0, config_1.saveProviderCredentials)(provider.name, finalCredentials);
            console.log(chalk_1.default.green('✓ Credentials saved to ~/.workos-migrations/config.json'));
        }
        return finalCredentials;
    }
    async selectEntities(availableEntities) {
        const enabledEntities = availableEntities.filter(entity => entity.enabled);
        const disabledEntities = availableEntities.filter(entity => !entity.enabled);
        if (enabledEntities.length === 0) {
            console.log(chalk_1.default.red('\n❌ No entities available for export.'));
            console.log(chalk_1.default.gray('This might be due to insufficient permissions/scopes.'));
            return [];
        }
        if (disabledEntities.length > 0) {
            console.log(chalk_1.default.yellow('\n⚠️  Some entities are not available (insufficient permissions):'));
            disabledEntities.forEach(entity => {
                console.log(chalk_1.default.gray(`   • ${entity.name}: ${entity.description}`));
            });
            console.log();
        }
        const { selectedEntities } = await inquirer_1.default.prompt([
            {
                type: 'checkbox',
                name: 'selectedEntities',
                message: 'Select entities to export:',
                choices: enabledEntities.map(entity => ({
                    name: `${entity.name} - ${entity.description}`,
                    value: entity.key,
                    checked: true,
                })),
                validate: (input) => input.length > 0 || 'Please select at least one entity',
            },
        ]);
        return selectedEntities;
    }
}
exports.CLI = CLI;
//# sourceMappingURL=cli.js.map