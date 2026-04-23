export interface CSVTemplate {
    name: string;
    description: string;
    filename: string;
    headers: string[];
    required: string[];
    optional: string[];
    example: string[];
    validation?: {
        [column: string]: (value: string) => boolean | string;
    };
}
export declare const CSV_TEMPLATES: Record<string, CSVTemplate>;
export declare function getTemplate(templateName: string): CSVTemplate | undefined;
export declare function getAllTemplates(): CSVTemplate[];
export declare function generateTemplateExample(templateName: string): string;
export declare function validateCSVHeaders(templateName: string, headers: string[]): {
    valid: boolean;
    errors: string[];
};
