import inquirer from 'inquirer';
import chalk from 'chalk';
import { getAllProviders, getProvider } from './providers';
import { Auth0Client } from './providers/auth0';
import { CSVClient, getAllTemplates } from './providers/csv';
import { CSV_TEMPLATES } from './providers/csv/templates';
import { ProviderCredentials, EntityType } from './types';
import { getProviderCredentials, saveProviderCredentials } from './utils/config';
import { saveExportResult } from './utils/export';
import { recordFeatureRequest } from './utils/feature-request';

export class CLI {
  async run(): Promise<void> {
    console.log(chalk.blue.bold('\n🔄 WorkOS Migration Tool\n'));

    try {
      const provider = await this.selectProvider();
      const action = await this.selectAction();

      if (action === 'export') {
        await this.handleExport(provider.name);
      } else if (action === 'import') {
        await this.handleImport(provider.name);
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Error:'),
        error instanceof Error ? error.message : 'Unknown error',
      );
      process.exit(1);
    }
  }

  private async selectProvider() {
    const providers = getAllProviders();

    const { providerName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'providerName',
        message: 'Select the identity provider:',
        choices: providers.map((provider) => ({
          name: provider.displayName,
          value: provider.name,
        })),
      },
    ]);

    return getProvider(providerName)!;
  }

  private async selectAction() {
    const { action } = await inquirer.prompt([
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
      console.log(chalk.gray('Goodbye! 👋'));
      process.exit(0);
    }

    return action;
  }

  private async handleExport(providerName: string): Promise<void> {
    const provider = getProvider(providerName)!;

    if (providerName !== 'auth0') {
      await recordFeatureRequest(providerName, 'export');
      return;
    }

    const credentials = await this.getCredentials(provider);
    const client = new Auth0Client(credentials);

    console.log(chalk.blue('\n📡 Connecting to Auth0...'));
    await client.authenticate();
    console.log(chalk.green('✓ Successfully authenticated with Auth0'));

    // Show available scopes
    const scopes = client.getScopes();
    if (scopes.length > 0) {
      console.log(chalk.blue('\n🔐 Available scopes:'));
      scopes.forEach((scope) => {
        console.log(chalk.gray(`   • ${scope}`));
      });
    }

    const availableEntities = await client.getAvailableEntities();
    const selectedEntities = await this.selectEntities(availableEntities);

    if (selectedEntities.length === 0) {
      console.log(chalk.yellow('No entities selected for export.'));
      return;
    }

    console.log(chalk.blue('\n📥 Exporting data...'));
    const result = await client.exportEntities(selectedEntities);

    saveExportResult(result);
  }

  private async handleImport(providerName: string): Promise<void> {
    if (providerName !== 'csv') {
      await recordFeatureRequest(providerName, 'import');
      return;
    }

    const provider = getProvider(providerName)!;
    const credentials = await this.getCredentials(provider);
    const client = new CSVClient(credentials);

    console.log(chalk.blue('\n🔑 Validating WorkOS API key...'));
    await client.authenticate();
    console.log(chalk.green('✓ Successfully authenticated with WorkOS'));

    const action = await this.selectCSVAction();

    if (action === 'generate-template') {
      await this.handleGenerateTemplate(client);
    } else if (action === 'import-csv') {
      await this.handleCSVImport(client);
    } else if (action === 'validate-csv') {
      await this.handleCSVValidation(client);
    } else if (action === 'list-jobs') {
      await this.handleListJobs(client);
    }
  }

  private async selectCSVAction(): Promise<string> {
    const { action } = await inquirer.prompt([
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

  private async handleGenerateTemplate(client: CSVClient): Promise<void> {
    const templates = getAllTemplates();

    const { templateType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'templateType',
        message: 'Select template type:',
        choices: templates.map((template) => ({
          name: `${template.name} - ${template.description}`,
          value: Object.keys(CSV_TEMPLATES).find((key) => CSV_TEMPLATES[key] === template),
        })),
      },
    ]);

    const { outputPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'outputPath',
        message: 'Output file path (leave empty for default):',
      },
    ]);

    try {
      const filename = client.generateTemplate(templateType, outputPath || undefined);
      console.log(chalk.green(`✅ Template generated: ${filename}`));

      const templateInfo = client.getTemplateInfo(templateType);
      console.log(chalk.blue('\n📋 Template Schema:'));
      console.log(chalk.gray(`   Required columns: ${templateInfo.required_columns.join(', ')}`));
      if (templateInfo.optional_columns.length > 0) {
        console.log(chalk.gray(`   Optional columns: ${templateInfo.optional_columns.join(', ')}`));
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Failed to generate template:'),
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async handleCSVImport(client: CSVClient): Promise<void> {
    const { csvFilePath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'csvFilePath',
        message: 'Enter CSV file path:',
        validate: (input: string) => input.length > 0 || 'CSV file path is required',
      },
    ]);

    const templates = getAllTemplates();
    const { templateType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'templateType',
        message: 'Select template type:',
        choices: templates.map((template) => ({
          name: `${template.name} - ${template.description}`,
          value: Object.keys(CSV_TEMPLATES).find((key) => CSV_TEMPLATES[key] === template),
        })),
      },
    ]);

    try {
      const result = await client.importCSV({
        csvFilePath,
        templateType,
      });

      if (result.success) {
        console.log(chalk.green(`✅ ${result.message}`));
        if (result.jobId) {
          console.log(chalk.blue(`📋 Job ID: ${result.jobId}`));
          console.log(chalk.gray('You can check the status with the "List import jobs" option.'));
        }
      } else {
        console.error(chalk.red(`❌ ${result.message}`));
        if (result.validationResult && result.validationResult.errors.length > 0) {
          console.log(chalk.red('\nValidation errors:'));
          result.validationResult.errors.forEach((error: string) => {
            console.log(chalk.red(`   • ${error}`));
          });
        }
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Import failed:'),
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async handleCSVValidation(client: CSVClient): Promise<void> {
    const { csvFilePath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'csvFilePath',
        message: 'Enter CSV file path:',
        validate: (input: string) => input.length > 0 || 'CSV file path is required',
      },
    ]);

    const templates = getAllTemplates();
    const { templateType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'templateType',
        message: 'Select template type:',
        choices: templates.map((template) => ({
          name: `${template.name} - ${template.description}`,
          value: Object.keys(CSV_TEMPLATES).find((key) => CSV_TEMPLATES[key] === template),
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
        console.log(chalk.green('✅ CSV validation passed'));
        if (result.validationResult) {
          console.log(
            chalk.blue(
              `📊 ${result.validationResult.validRows}/${result.validationResult.totalRows} rows are valid`,
            ),
          );

          if (result.validationResult.warnings.length > 0) {
            console.log(chalk.yellow('\n⚠️  Warnings:'));
            result.validationResult.warnings.forEach((warning: string) => {
              console.log(chalk.yellow(`   • ${warning}`));
            });
          }
        }
      } else {
        console.error(chalk.red('❌ CSV validation failed'));
        if (result.validationResult && result.validationResult.errors.length > 0) {
          console.log(chalk.red('\nValidation errors:'));
          result.validationResult.errors.forEach((error: string) => {
            console.log(chalk.red(`   • ${error}`));
          });
        }
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Validation failed:'),
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async handleListJobs(client: CSVClient): Promise<void> {
    try {
      const jobs = await client.listImportJobs();

      if (jobs.length === 0) {
        console.log(chalk.gray('No import jobs found.'));
        return;
      }

      console.log(chalk.blue('\n📋 Import Jobs:'));
      jobs.forEach((job) => {
        const statusColor =
          job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : 'yellow';
        console.log(
          chalk.gray(`   • ${job.jobId} - ${chalk[statusColor](job.status)} - ${job.message}`),
        );
      });
    } catch (error) {
      console.error(
        chalk.red('❌ Failed to list jobs:'),
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }

  private async getCredentials(provider: any): Promise<ProviderCredentials> {
    const savedCredentials = getProviderCredentials(provider.name);
    const credentials: ProviderCredentials = {};

    // Check environment variables and saved credentials
    let hasAllCredentials = true;
    for (const field of provider.credentials) {
      const envValue = field.envVar ? process.env[field.envVar] : undefined;
      const savedValue = savedCredentials[field.key];

      if (envValue) {
        credentials[field.key] = envValue;
      } else if (savedValue) {
        credentials[field.key] = savedValue;
      } else if (field.required) {
        hasAllCredentials = false;
      }
    }

    if (hasAllCredentials) {
      console.log(
        chalk.green(`✓ Using ${provider.displayName} credentials from environment/config`),
      );
      return credentials;
    }

    console.log(chalk.yellow(`${provider.displayName} credentials not found or incomplete.`));
    console.log(chalk.gray('Please provide them below:\n'));

    const questions = provider.credentials
      .filter((field: any) => !credentials[field.key])
      .map((field: any) => ({
        type: field.type,
        name: field.key,
        message: `Enter ${field.name}:`,
        validate: (input: string) =>
          field.required && input.length === 0 ? `${field.name} is required` : true,
        mask: field.type === 'password' ? '*' : undefined,
      }));

    const answers = await inquirer.prompt(questions);

    const finalCredentials = { ...credentials, ...answers };

    // Ask if they want to save credentials
    const { saveCredentials } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveCredentials',
        message: 'Save credentials to config file for future use?',
        default: false,
      },
    ]);

    if (saveCredentials) {
      saveProviderCredentials(provider.name, finalCredentials);
      console.log(chalk.green('✓ Credentials saved to ~/.workos-migrations/config.json'));
    }

    return finalCredentials;
  }

  private async selectEntities(availableEntities: EntityType[]): Promise<string[]> {
    const enabledEntities = availableEntities.filter((entity) => entity.enabled);
    const disabledEntities = availableEntities.filter((entity) => !entity.enabled);

    if (enabledEntities.length === 0) {
      console.log(chalk.red('\n❌ No entities available for export.'));
      console.log(chalk.gray('This might be due to insufficient permissions/scopes.'));
      return [];
    }

    if (disabledEntities.length > 0) {
      console.log(
        chalk.yellow('\n⚠️  Some entities are not available (insufficient permissions):'),
      );
      disabledEntities.forEach((entity) => {
        console.log(chalk.gray(`   • ${entity.name}: ${entity.description}`));
      });
      console.log();
    }

    const { selectedEntities } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selectedEntities',
        message: 'Select entities to export:',
        choices: enabledEntities.map((entity) => ({
          name: `${entity.name} - ${entity.description}`,
          value: entity.key,
          checked: true,
        })),
        validate: (input: string[]) => input.length > 0 || 'Please select at least one entity',
      },
    ]);

    return selectedEntities;
  }
}
