#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Auth0Client } from './auth0-client';
import { exportConnections } from './export';

interface Auth0Credentials {
  clientId: string;
  clientSecret: string;
  domain: string;
}

async function getAuth0Credentials(): Promise<Auth0Credentials> {
  const envCredentials = {
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    domain: process.env.AUTH0_API_DOMAIN,
  };

  if (envCredentials.clientId && envCredentials.clientSecret && envCredentials.domain) {
    console.log(chalk.green('✓ Using Auth0 credentials from environment variables'));
    return {
      clientId: envCredentials.clientId,
      clientSecret: envCredentials.clientSecret,
      domain: envCredentials.domain,
    };
  }

  console.log(chalk.yellow('Auth0 credentials not found in environment variables.'));
  console.log(chalk.gray('Please provide them below:\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'clientId',
      message: 'Enter Auth0 Client ID:',
      validate: (input: string) => input.length > 0 || 'Client ID is required',
      default: envCredentials.clientId || undefined,
    },
    {
      type: 'password',
      name: 'clientSecret',
      message: 'Enter Auth0 Client Secret:',
      validate: (input: string) => input.length > 0 || 'Client Secret is required',
      mask: '*',
    },
    {
      type: 'input',
      name: 'domain',
      message: 'Enter Auth0 API Domain (e.g., your-tenant.auth0.com):',
      validate: (input: string) => {
        if (input.length === 0) return 'Domain is required';
        if (!input.includes('.')) return 'Please enter a valid domain';
        return true;
      },
      default: envCredentials.domain || undefined,
    },
  ]);

  return answers;
}

async function showMainMenu(): Promise<string> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        {
          name: 'Export connections and applications from Auth0',
          value: 'export',
        },
        {
          name: 'Exit',
          value: 'exit',
        },
      ],
    },
  ]);

  return action;
}

async function main() {
  console.log(chalk.blue.bold('\n🔄 Auth0 Connection Migration Tool\n'));

  try {
    const action = await showMainMenu();

    if (action === 'exit') {
      console.log(chalk.gray('Goodbye! 👋'));
      process.exit(0);
    }

    if (action === 'export') {
      const credentials = await getAuth0Credentials();
      const auth0Client = new Auth0Client(credentials);

      console.log(chalk.blue('\n📡 Connecting to Auth0...'));
      await auth0Client.authenticate();

      console.log(chalk.green('✓ Successfully authenticated with Auth0'));
      console.log(chalk.blue('📥 Exporting connections and applications...'));

      await exportConnections(auth0Client);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}