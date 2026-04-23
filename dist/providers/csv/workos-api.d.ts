export interface WorkOSImportRequest {
    templateType: string;
    csvFilePath: string;
}
export interface WorkOSImportResponse {
    jobId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    message: string;
    uploadUrl?: string;
}
export declare class WorkOSAPIClient {
    private httpClient;
    private apiKey;
    constructor(apiKey: string, baseURL?: string);
    validateApiKey(): Promise<void>;
    startCSVImport(request: WorkOSImportRequest): Promise<WorkOSImportResponse>;
    getImportStatus(jobId: string): Promise<WorkOSImportResponse>;
    listImportJobs(): Promise<WorkOSImportResponse[]>;
}
