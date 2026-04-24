import fs from 'node:fs';
export class ErrorWriter {
    stream = null;
    count = 0;
    constructor(filePath) {
        if (filePath) {
            this.stream = fs.createWriteStream(filePath, { flags: 'w', encoding: 'utf8' });
        }
    }
    write(error) {
        this.count += 1;
        if (this.stream) {
            this.stream.write(JSON.stringify(error) + '\n');
        }
    }
    getCount() {
        return this.count;
    }
    async close() {
        if (!this.stream)
            return;
        await new Promise((resolve, reject) => {
            this.stream.end((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
}
