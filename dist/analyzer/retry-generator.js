import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
/**
 * Generate a retry CSV containing only rows that had retryable errors.
 *
 * Reads the error JSONL to find retryable emails, then filters the original CSV
 * to include only those rows.
 */
export async function generateRetryCsv(errorsPath, originalCsvPath, outputCsvPath, dedupe) {
    // Step 1: Collect retryable emails from error JSONL
    const retryableEmails = new Set();
    const fileStream = createReadStream(errorsPath, { encoding: 'utf-8' });
    const rl = createInterface({ input: fileStream, crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.trim())
            continue;
        try {
            const error = JSON.parse(line);
            // Retryable: rate limit (429), server errors (500+), no HTTP status
            const retryable = error.httpStatus === 429 ||
                (error.httpStatus !== undefined && error.httpStatus >= 500) ||
                !error.httpStatus;
            if (retryable && error.email) {
                retryableEmails.add(error.email.toLowerCase());
            }
        }
        catch {
            // Skip invalid JSON
        }
    }
    const totalRetryable = retryableEmails.size;
    // Step 2: Filter original CSV to retryable rows
    const rows = [];
    let headers = [];
    const seenEmails = new Set();
    let deduplicatedCount = 0;
    await new Promise((resolve, reject) => {
        const inputStream = createReadStream(originalCsvPath);
        const parser = parse({ columns: true, skip_empty_lines: true, trim: true, bom: true });
        let headerRead = false;
        inputStream
            .pipe(parser)
            .on('data', (row) => {
            if (!headerRead) {
                headerRead = true;
                headers = Object.keys(row);
            }
            const email = typeof row.email === 'string' ? row.email.toLowerCase().trim() : '';
            if (!email || !retryableEmails.has(email))
                return;
            if (dedupe) {
                if (seenEmails.has(email)) {
                    deduplicatedCount++;
                    return;
                }
                seenEmails.add(email);
            }
            rows.push(row);
        })
            .on('end', resolve)
            .on('error', reject);
    });
    // Step 3: Write retry CSV
    await new Promise((resolve, reject) => {
        const outputStream = createWriteStream(outputCsvPath);
        const stringifier = stringify({ header: true, columns: headers });
        stringifier.pipe(outputStream).on('finish', resolve).on('error', reject);
        for (const row of rows) {
            stringifier.write(row);
        }
        stringifier.end();
    });
    return {
        totalRetryable,
        rowsWritten: rows.length,
        deduplicatedCount,
    };
}
