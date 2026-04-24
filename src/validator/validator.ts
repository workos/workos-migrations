import { createReadStream, createWriteStream } from 'node:fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import type { CSVRow } from '../shared/types.js';
import { validateHeaders, validateRow } from './rules.js';
import type { ValidationIssue } from './rules.js';
import { autoFixRow } from './auto-fixer.js';
import type { AutoFixChange } from './rules.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  totalRows: number;
  validRows: number;
  fixesApplied?: number;
  duplicateEmails: string[];
}

export interface ValidateOptions {
  csvPath: string;
  autoFix?: boolean;
  outputPath?: string;
  strict?: boolean;
  quiet?: boolean;
}

/**
 * 3-pass CSV validator.
 *
 * Pass 1: Header validation (required columns, unknown columns)
 * Pass 2: Row validation (email, metadata, password, boolean, org conflicts) + auto-fix
 * Pass 3: Cross-row checks (duplicate emails, duplicate email+org combos)
 */
export async function validateCsv(options: ValidateOptions): Promise<ValidationResult> {
  const allErrors: ValidationIssue[] = [];
  const allWarnings: ValidationIssue[] = [];
  let totalRows = 0;
  let validRows = 0;
  let fixesApplied = 0;
  const allChanges: AutoFixChange[] = [];

  // Pass 1 + 2: Stream CSV, validate headers on first row, then validate each row
  const rows: CSVRow[] = [];
  let headers: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const inputStream = createReadStream(options.csvPath);
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    });

    let headerValidated = false;

    inputStream
      .pipe(parser)
      .on('data', (row: CSVRow) => {
        // Pass 1: Validate headers on first row
        if (!headerValidated) {
          headerValidated = true;
          headers = Object.keys(row);
          const headerIssues = validateHeaders(headers);
          for (const issue of headerIssues) {
            if (issue.severity === 'error') allErrors.push(issue);
            else allWarnings.push(issue);
          }
        }

        totalRows++;

        // Pass 2: Validate row
        let rowToProcess = row;

        // Auto-fix if enabled
        if (options.autoFix) {
          const { fixed, changes } = autoFixRow(row, totalRows);
          rowToProcess = fixed;
          fixesApplied += changes.length;
          allChanges.push(...changes);
        }

        const rowIssues = validateRow(rowToProcess, totalRows);
        let hasError = false;
        for (const issue of rowIssues) {
          if (issue.severity === 'error') {
            allErrors.push(issue);
            hasError = true;
          } else {
            allWarnings.push(issue);
          }
        }

        if (!hasError) validRows++;
        rows.push(rowToProcess);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Pass 3: Cross-row checks (duplicates)
  const emailCounts = new Map<string, number[]>();
  const emailOrgPairs = new Map<string, number>();
  const duplicateEmails: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const email = typeof row.email === 'string' ? row.email.toLowerCase().trim() : '';
    if (!email) continue;

    const rowNum = i + 1;
    const existing = emailCounts.get(email);
    if (existing) {
      existing.push(rowNum);
      if (existing.length === 2) {
        duplicateEmails.push(email);
        allWarnings.push({
          row: rowNum,
          column: 'email',
          message: `Duplicate email "${email}" (first seen at row ${existing[0]})`,
          severity: 'warning',
          fixable: false,
        });
      } else {
        allWarnings.push({
          row: rowNum,
          column: 'email',
          message: `Duplicate email "${email}" (seen ${existing.length} times)`,
          severity: 'warning',
          fixable: false,
        });
      }
    } else {
      emailCounts.set(email, [rowNum]);
    }

    // Check duplicate email+org combo (same email + same org = actual dup, different org = multi-membership = OK)
    const orgKey = String(row.org_id || row.org_external_id || row.org_name || '').trim();
    if (orgKey) {
      const pairKey = `${email}::${orgKey}`;
      const existingRow = emailOrgPairs.get(pairKey);
      if (existingRow) {
        allWarnings.push({
          row: rowNum,
          message: `Duplicate email+org pair: "${email}" in org "${orgKey}" (first seen at row ${existingRow})`,
          severity: 'warning',
          fixable: false,
        });
      } else {
        emailOrgPairs.set(pairKey, rowNum);
      }
    }
  }

  // Write fixed CSV if auto-fix was enabled
  if (options.autoFix && allChanges.length > 0) {
    const outputPath = options.outputPath || options.csvPath.replace('.csv', '-fixed.csv');
    await writeFixedCsv(rows, headers, outputPath);
  }

  const valid = options.strict
    ? allErrors.length === 0 && allWarnings.length === 0
    : allErrors.length === 0;

  return {
    valid,
    errors: allErrors,
    warnings: allWarnings,
    totalRows,
    validRows,
    fixesApplied: options.autoFix ? fixesApplied : undefined,
    duplicateEmails,
  };
}

async function writeFixedCsv(rows: CSVRow[], headers: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const outputStream = createWriteStream(outputPath);
    const stringifier = stringify({ header: true, columns: headers });

    stringifier
      .pipe(outputStream)
      .on('finish', resolve)
      .on('error', reject);

    for (const row of rows) {
      stringifier.write(row);
    }
    stringifier.end();
  });
}
