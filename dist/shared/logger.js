import chalk from 'chalk';
let currentLevel = 'info';
const levels = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
export function setLogLevel(level) {
    currentLevel = level;
}
function shouldLog(level) {
    return levels[level] >= levels[currentLevel];
}
export function debug(message) {
    if (shouldLog('debug'))
        console.log(chalk.gray(message));
}
export function info(message) {
    if (shouldLog('info'))
        console.log(chalk.blue(message));
}
export function success(message) {
    if (shouldLog('info'))
        console.log(chalk.green(message));
}
export function warn(message) {
    if (shouldLog('warn'))
        console.log(chalk.yellow(message));
}
export function error(message) {
    if (shouldLog('error'))
        console.error(chalk.red(message));
}
