import fs from 'node:fs';
import type { ErrorRecord } from '../shared/types.js';

export class ErrorWriter {
  private stream: fs.WriteStream | null = null;
  private count = 0;

  constructor(filePath?: string) {
    if (filePath) {
      this.stream = fs.createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });
    }
  }

  write(error: ErrorRecord): void {
    this.count += 1;
    if (this.stream) {
      this.stream.write(JSON.stringify(error) + '\n');
    }
  }

  getCount(): number {
    return this.count;
  }

  async close(): Promise<void> {
    if (!this.stream) return;
    await new Promise<void>((resolve, reject) => {
      this.stream!.end((err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
