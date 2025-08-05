import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { CSVTemplate, getTemplate } from './templates';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalRows: number;
  validRows: number;
}

export interface CSVValidationOptions {
  skipEmptyLines?: boolean;
  maxErrors?: number;
}

export class CSVValidator {
  static async validateFile(
    filePath: string, 
    templateName: string, 
    options: CSVValidationOptions = {}
  ): Promise<ValidationResult> {
    const template = getTemplate(templateName);
    if (!template) {
      return {
        valid: false,
        errors: [`Template ${templateName} not found`],
        warnings: [],
        totalRows: 0,
        validRows: 0,
      };
    }

    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        errors: [`File not found: ${filePath}`],
        warnings: [],
        totalRows: 0,
        validRows: 0,
      };
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      return this.validateContent(fileContent, template, options);
    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: [],
        totalRows: 0,
        validRows: 0,
      };
    }
  }

  static validateContent(
    content: string, 
    template: CSVTemplate, 
    options: CSVValidationOptions = {}
  ): ValidationResult {
    const { skipEmptyLines = true, maxErrors = 100 } = options;
    const errors: string[] = [];
    const warnings: string[] = [];
    let validRows = 0;
    let totalRows = 0;

    try {
      const records = parse(content, {
        columns: true,
        skip_empty_lines: skipEmptyLines,
        trim: true,
      });

      totalRows = records.length;

      if (records.length === 0) {
        errors.push('CSV file is empty or contains no data rows');
        return { valid: false, errors, warnings, totalRows: 0, validRows: 0 };
      }

      // Validate headers
      const headers = Object.keys(records[0] as Record<string, any>);
      const headerValidation = this.validateHeaders(headers, template);
      errors.push(...headerValidation.errors);

      if (!headerValidation.valid) {
        return { valid: false, errors, warnings, totalRows, validRows: 0 };
      }

      // Validate each row
      for (let i = 0; i < records.length && errors.length < maxErrors; i++) {
        const row = records[i];
        const rowErrors = this.validateRow(row, template, i + 2); // +2 because CSV rows start at 2 (after header)
        
        if (rowErrors.length === 0) {
          validRows++;
        } else {
          errors.push(...rowErrors);
        }
      }

      // Check for common issues
      if (validRows < totalRows) {
        warnings.push(`${totalRows - validRows} out of ${totalRows} rows have validation errors`);
      }

    } catch (error) {
      errors.push(`Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalRows,
      validRows,
    };
  }

  private static validateHeaders(headers: string[], template: CSVTemplate): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check for required headers
    const missingRequired = template.required.filter(required => !headers.includes(required));
    if (missingRequired.length > 0) {
      errors.push(`Missing required columns: ${missingRequired.join(', ')}`);
    }
    
    // Check for unexpected headers
    const expectedHeaders = [...template.required, ...template.optional];
    const unexpectedHeaders = headers.filter(header => !expectedHeaders.includes(header));
    if (unexpectedHeaders.length > 0) {
      errors.push(`Unexpected columns: ${unexpectedHeaders.join(', ')}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  private static validateRow(row: any, template: CSVTemplate, rowNumber: number): string[] {
    const errors: string[] = [];
    
    // Check required fields
    for (const required of template.required) {
      const value = row[required];
      if (!value || value.trim() === '') {
        errors.push(`Row ${rowNumber}: Missing required field '${required}'`);
      }
    }
    
    // Apply custom validations
    if (template.validation) {
      for (const [column, validator] of Object.entries(template.validation)) {
        const value = row[column];
        if (value !== undefined && value !== null && value !== '') {
          const result = validator(value);
          if (result !== true) {
            const errorMessage = typeof result === 'string' ? result : `Invalid value for '${column}'`;
            errors.push(`Row ${rowNumber}: ${errorMessage} (value: '${value}')`);
          }
        }
      }
    }
    
    return errors;
  }
}