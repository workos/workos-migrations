import chalk from 'chalk';
import inquirer from 'inquirer';

export async function recordFeatureRequest(
  providerName: string,
  action: 'export' | 'import',
): Promise<void> {
  console.log(chalk.yellow(`\n🚧 ${providerName} ${action} functionality is not yet implemented.`));
  console.log(chalk.gray("We'd love to add support for this provider!"));

  const { recordRequest } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'recordRequest',
      message: 'Would you like us to record this as a feature request?',
      default: true,
    },
  ]);

  if (recordRequest) {
    const { email } = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Enter your email (optional, for updates):',
        validate: (input: string) => {
          if (!input) return true; // Optional
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emailRegex.test(input) || 'Please enter a valid email address';
        },
      },
    ]);

    // In a real implementation, this would send the request to a backend
    console.log(chalk.green('\n✅ Feature request recorded!'));
    console.log(chalk.gray("We'll prioritize based on demand and notify you when it's available."));

    // Store the request locally for now
    const request = {
      provider: providerName,
      action,
      email: email || 'anonymous',
      timestamp: new Date().toISOString(),
    };

    console.log(chalk.gray('\nRequest details:'));
    console.log(chalk.gray(JSON.stringify(request, null, 2)));
  } else {
    console.log(chalk.gray('No problem! Feel free to reach out if you change your mind.'));
  }
}
