import { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../types';
export interface CSVImportRequest {
    templateType: string;
    csvFilePath: string;
    validateOnly?: boolean;
}
export interface CSVImportResult {
    success: boolean;
    jobId?: string;
    validationResult?: any;
    message: string;
}
export declare class CSVClient implements ProviderClient {
    private credentials;
    private workosClient;
    constructor(credentials: ProviderCredentials);
    authenticate(): Promise<void>;
    validateCredentials(): Promise<void>;
    getAvailableEntities(): Promise<EntityType[]>;
    exportEntities(entityTypes: string[]): Promise<ExportResult>;
    importCSV(request: CSVImportRequest): Promise<CSVImportResult>;
    getImportStatus(jobId: string): Promise<any>;
    listImportJobs(): Promise<any[]>;
    generateTemplate(templateType: string, outputPath?: string): string;
    getTemplateInfo(templateType: string): any;
}
//# sourceMappingURL=client.d.ts.map