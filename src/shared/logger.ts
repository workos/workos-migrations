import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let currentLevel: LogLevel = 'info';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

export function debug(message: string): void {
  if (shouldLog('debug')) console.log(chalk.gray(message));
}

export function info(message: string): void {
  if (shouldLog('info')) console.log(chalk.blue(message));
}

export function success(message: string): void {
  if (shouldLog('info')) console.log(chalk.green(message));
}

export function warn(message: string): void {
  if (shouldLog('warn')) console.log(chalk.yellow(message));
}

export function error(message: string): void {
  if (shouldLog('error')) console.error(chalk.red(message));
}
