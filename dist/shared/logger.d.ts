export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export declare function setLogLevel(level: LogLevel): void;
export declare function debug(message: string): void;
export declare function info(message: string): void;
export declare function success(message: string): void;
export declare function warn(message: string): void;
export declare function error(message: string): void;
