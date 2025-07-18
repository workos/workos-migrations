#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const auth0_client_1 = require("./auth0-client");
const export_1 = require("./export");
async function getAuth0Credentials() {
    const envCredentials = {
        clientId: process.env.AUTH0_CLIENT_ID,
        clientSecret: process.env.AUTH0_CLIENT_SECRET,
        domain: process.env.AUTH0_API_DOMAIN,
    };
    if (envCredentials.clientId && envCredentials.clientSecret && envCredentials.domain) {
        console.log(chalk_1.default.green('✓ Using Auth0 credentials from environment variables'));
        return {
            clientId: envCredentials.clientId,
            clientSecret: envCredentials.clientSecret,
            domain: envCredentials.domain,
        };
    }
    console.log(chalk_1.default.yellow('Auth0 credentials not found in environment variables.'));
    console.log(chalk_1.default.gray('Please provide them below:\n'));
    const answers = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'clientId',
            message: 'Enter Auth0 Client ID:',
            validate: (input) => input.length > 0 || 'Client ID is required',
            default: envCredentials.clientId || undefined,
        },
        {
            type: 'password',
            name: 'clientSecret',
            message: 'Enter Auth0 Client Secret:',
            validate: (input) => input.length > 0 || 'Client Secret is required',
            mask: '*',
        },
        {
            type: 'input',
            name: 'domain',
            message: 'Enter Auth0 API Domain (e.g., your-tenant.auth0.com):',
            validate: (input) => {
                if (input.length === 0)
                    return 'Domain is required';
                if (!input.includes('.'))
                    return 'Please enter a valid domain';
                return true;
            },
            default: envCredentials.domain || undefined,
        },
    ]);
    return answers;
}
async function showMainMenu() {
    const { action } = await inquirer_1.default.prompt([
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
    console.log(chalk_1.default.blue.bold('\n🔄 Auth0 Connection Migration Tool\n'));
    try {
        const action = await showMainMenu();
        if (action === 'exit') {
            console.log(chalk_1.default.gray('Goodbye! 👋'));
            process.exit(0);
        }
        if (action === 'export') {
            const credentials = await getAuth0Credentials();
            const auth0Client = new auth0_client_1.Auth0Client(credentials);
            console.log(chalk_1.default.blue('\n📡 Connecting to Auth0...'));
            await auth0Client.authenticate();
            console.log(chalk_1.default.green('✓ Successfully authenticated with Auth0'));
            console.log(chalk_1.default.blue('📥 Exporting connections and applications...'));
            await (0, export_1.exportConnections)(auth0Client);
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('❌ Error:'), error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=index.js.map