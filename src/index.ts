#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { CLI } from './cli';
import { getProvider, getAllProviders } from './providers';
import { Auth0Client } from './providers/auth0';
import { CSVClient, getAllTemplates } from './providers/csv';
import { getProviderCredentials } from './utils/config';
import { saveExportResult } from './utils/export';
import { recordFeatureRequest } from './utils/feature-request';

const program = new Command();

program
  .name('workos-migrations')
  .description('CLI tool to migrate data from various identity providers to WorkOS')
  .version('1.0.0');

// Interactive mode (default)
program
  .command('interactive')
  .description('Run in interactive mode')
  .action(async () => {
    const cli = new CLI();
    await cli.run();
  });

// Provider-specific commands
program
  .command('auth0')
  .description('Auth0 migration commands')
  .argument('<action>', 'Action to perform (export|import)')
  .option('--entities <entities>', 'Comma-separated list of entities to export')
  .option('--client-id <clientId>', 'Auth0 Client ID')
  .option('--client-secret <clientSecret>', 'Auth0 Client Secret')
  .option('--domain <domain>', 'Auth0 Domain')
  .action(async (action, options) => {
    if (action === 'import') {
      await recordFeatureRequest('auth0', 'import');
      return;
    }

    if (action !== 'export') {
      console.error(chalk.red('❌ Invalid action. Use "export" or "import"'));
      process.exit(1);
    }

    try {
      const credentials = {
        clientId: options.clientId || process.env.AUTH0_CLIENT_ID,
        clientSecret: options.clientSecret || process.env.AUTH0_CLIENT_SECRET,
        domain: options.domain || process.env.AUTH0_DOMAIN,
      };

      // Check if we have all required credentials
      if (!credentials.clientId || !credentials.clientSecret || !credentials.domain) {
        const savedCredentials = getProviderCredentials('auth0');
        credentials.clientId = credentials.clientId || savedCredentials.clientId;
        credentials.clientSecret = credentials.clientSecret || savedCredentials.clientSecret;
        credentials.domain = credentials.domain || savedCredentials.domain;
      }

      if (!credentials.clientId || !credentials.clientSecret || !credentials.domain) {
        console.error(chalk.red('❌ Missing required credentials.'));
        console.error(chalk.gray('Provide via CLI options, environment variables, or config file:'));
        console.error(chalk.gray('  • --client-id or AUTH0_CLIENT_ID'));
        console.error(chalk.gray('  • --client-secret or AUTH0_CLIENT_SECRET'));
        console.error(chalk.gray('  • --domain or AUTH0_DOMAIN'));
        process.exit(1);
      }

      const client = new Auth0Client(credentials);
      
      console.log(chalk.blue('📡 Connecting to Auth0...'));
      await client.authenticate();
      console.log(chalk.green('✓ Successfully authenticated with Auth0'));

      const availableEntities = await client.getAvailableEntities();
      const enabledEntityKeys = availableEntities
        .filter(entity => entity.enabled)
        .map(entity => entity.key);

      let selectedEntities = enabledEntityKeys;

      if (options.entities) {
        const requestedEntities = options.entities.split(',').map((e: string) => e.trim());
        const invalidEntities = requestedEntities.filter((e: string) => !enabledEntityKeys.includes(e));
        
        if (invalidEntities.length > 0) {
          console.error(chalk.red(`❌ Invalid entities: ${invalidEntities.join(', ')}`));
          console.error(chalk.gray(`Available entities: ${enabledEntityKeys.join(', ')}`));
          process.exit(1);
        }
        
        selectedEntities = requestedEntities;
      }

      console.log(chalk.blue(`📥 Exporting entities: ${selectedEntities.join(', ')}`));
      const result = await client.exportEntities(selectedEntities);

      saveExportResult(result);
    } catch (error) {
      console.error(
        chalk.red('❌ Error:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// CSV import commands
program
  .command('csv')
  .description('CSV import to WorkOS commands')
  .argument('<action>', 'Action to perform (generate-template|import|validate|list-jobs)')
  .option('--api-key <apiKey>', 'WorkOS API Key')
  .option('--template <template>', 'Template type (users|organizations|organization_memberships|connections)')
  .option('--file <file>', 'CSV file path')
  .option('--output <output>', 'Output file path for template generation')
  .action(async (action, options) => {
    try {
      // For template generation, we don't need API key
      if (action === 'generate-template') {
        if (!options.template) {
          console.error(chalk.red('❌ Template type is required for generate-template action.'));
          console.error(chalk.gray('Available templates: users, organizations, organization_memberships, connections'));
          process.exit(1);
        }

        // Generate template without API key
        const { generateTemplateExample, getTemplate } = await import('./providers/csv/templates');
        const template = getTemplate(options.template);
        
        if (!template) {
          console.error(chalk.red(`❌ Unknown template: ${options.template}`));
          console.error(chalk.gray('Available templates: users, organizations, organization_memberships, connections'));
          process.exit(1);
        }

        const content = generateTemplateExample(options.template);
        const filename = options.output || template.filename;
        
        const fs = await import('fs');
        fs.writeFileSync(filename, content);
        
        console.log(chalk.green(`✅ Template generated: ${filename}`));
        console.log(chalk.blue('\n📋 Template Schema:'));
        console.log(chalk.gray(`   Required columns: ${template.required.join(', ')}`));
        if (template.optional.length > 0) {
          console.log(chalk.gray(`   Optional columns: ${template.optional.join(', ')}`));
        }
        return;
      }

      // For other actions, API key is required
      const credentials = {
        workosApiKey: options.apiKey || process.env.WORKOS_API_KEY,
      };

      if (!credentials.workosApiKey) {
        const savedCredentials = getProviderCredentials('csv');
        credentials.workosApiKey = savedCredentials.workosApiKey;
      }

      if (!credentials.workosApiKey) {
        console.error(chalk.red('❌ Missing required WorkOS API key.'));
        console.error(chalk.gray('Provide via --api-key, WORKOS_API_KEY environment variable, or config file'));
        process.exit(1);
      }

      const client = new CSVClient(credentials);

      if (action === 'validate') {
        if (!options.file || !options.template) {
          console.error(chalk.red('❌ Both --file and --template are required for validate action.'));
          process.exit(1);
        }

        const result = await client.importCSV({
          csvFilePath: options.file,
          templateType: options.template,
          validateOnly: true,
        });

        if (result.success) {
          console.log(chalk.green('✅ CSV validation passed'));
          if (result.validationResult) {
            console.log(chalk.blue(`📊 ${result.validationResult.validRows}/${result.validationResult.totalRows} rows are valid`));
          }
        } else {
          console.error(chalk.red('❌ CSV validation failed'));
          if (result.validationResult && result.validationResult.errors.length > 0) {
            result.validationResult.errors.forEach((error: string) => {
              console.log(chalk.red(`   • ${error}`));
            });
          }
          process.exit(1);
        }
      } else if (action === 'import') {
        if (!options.file || !options.template) {
          console.error(chalk.red('❌ Both --file and --template are required for import action.'));
          process.exit(1);
        }

        console.log(chalk.blue('🔑 Validating WorkOS API key...'));
        await client.authenticate();
        console.log(chalk.green('✓ Successfully authenticated with WorkOS'));

        const result = await client.importCSV({
          csvFilePath: options.file,
          templateType: options.template,
        });

        if (result.success) {
          console.log(chalk.green(`✅ ${result.message}`));
          if (result.jobId) {
            console.log(chalk.blue(`📋 Job ID: ${result.jobId}`));
          }
        } else {
          console.error(chalk.red(`❌ ${result.message}`));
          process.exit(1);
        }
      } else if (action === 'list-jobs') {
        console.log(chalk.blue('🔑 Validating WorkOS API key...'));
        await client.authenticate();
        
        const jobs = await client.listImportJobs();
        
        if (jobs.length === 0) {
          console.log(chalk.gray('No import jobs found.'));
          return;
        }

        console.log(chalk.blue('\n📋 Import Jobs:'));
        jobs.forEach(job => {
          const statusColor = job.status === 'completed' ? 'green' : 
                             job.status === 'failed' ? 'red' : 'yellow';
          console.log(chalk.gray(`   • ${job.jobId} - ${chalk[statusColor](job.status)} - ${job.message}`));
        });
      } else {
        console.error(chalk.red(`❌ Invalid action: ${action}`));
        console.error(chalk.gray('Available actions: generate-template, import, validate, list-jobs'));
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red('❌ Error:'),
        error instanceof Error ? error.message : 'Unknown error'
      );
      process.exit(1);
    }
  });

// Add commands for other providers (which will show feature requests)
['clerk', 'firebase', 'cognito'].forEach(providerName => {
  const provider = getProvider(providerName);
  if (provider) {
    program
      .command(providerName)
      .description(`${provider.displayName} migration commands`)
      .argument('<action>', 'Action to perform (export|import)')
      .action(async (action) => {
        await recordFeatureRequest(providerName, action as 'export' | 'import');
      });
  }
});

// List available providers
program
  .command('providers')
  .description('List all available providers')
  .action(() => {
    console.log(chalk.blue('Available providers:\n'));
    getAllProviders().forEach(provider => {
      const status = provider.name === 'auth0' ? 
        chalk.green('✓ Available') : 
        chalk.yellow('🚧 Coming soon');
      console.log(`  ${provider.displayName} (${provider.name}) - ${status}`);
    });
  });

// Default to interactive mode if no command is provided
if (process.argv.length === 2) {
  const cli = new CLI();
  cli.run();
} else {
  program.parse();
}