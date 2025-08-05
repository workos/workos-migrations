import { CSVTemplate } from './templates';
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
export declare class CSVValidator {
    static validateFile(filePath: string, templateName: string, options?: CSVValidationOptions): Promise<ValidationResult>;
    static validateContent(content: string, template: CSVTemplate, options?: CSVValidationOptions): ValidationResult;
    private static validateHeaders;
    private static validateRow;
}
//# sourceMappingURL=validator.d.ts.map