import type { ErrorRecord } from '../shared/types.js';
export declare class ErrorWriter {
    private stream;
    private count;
    constructor(filePath?: string);
    write(error: ErrorRecord): void;
    getCount(): number;
    close(): Promise<void>;
}
