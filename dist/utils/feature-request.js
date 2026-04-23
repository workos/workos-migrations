"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordFeatureRequest = recordFeatureRequest;
const chalk_1 = __importDefault(require("chalk"));
const inquirer_1 = __importDefault(require("inquirer"));
async function recordFeatureRequest(providerName, action) {
    console.log(chalk_1.default.yellow(`\n🚧 ${providerName} ${action} functionality is not yet implemented.`));
    console.log(chalk_1.default.gray("We'd love to add support for this provider!"));
    const { recordRequest } = await inquirer_1.default.prompt([
        {
            type: 'confirm',
            name: 'recordRequest',
            message: 'Would you like us to record this as a feature request?',
            default: true,
        },
    ]);
    if (recordRequest) {
        const { email } = await inquirer_1.default.prompt([
            {
                type: 'input',
                name: 'email',
                message: 'Enter your email (optional, for updates):',
                validate: (input) => {
                    if (!input)
                        return true; // Optional
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    return emailRegex.test(input) || 'Please enter a valid email address';
                },
            },
        ]);
        // In a real implementation, this would send the request to a backend
        console.log(chalk_1.default.green('\n✅ Feature request recorded!'));
        console.log(chalk_1.default.gray("We'll prioritize based on demand and notify you when it's available."));
        // Store the request locally for now
        const request = {
            provider: providerName,
            action,
            email: email || 'anonymous',
            timestamp: new Date().toISOString(),
        };
        console.log(chalk_1.default.gray('\nRequest details:'));
        console.log(chalk_1.default.gray(JSON.stringify(request, null, 2)));
    }
    else {
        console.log(chalk_1.default.gray('No problem! Feel free to reach out if you change your mind.'));
    }
}
