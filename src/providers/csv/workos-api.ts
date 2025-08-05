import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import FormData from 'form-data';

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

export class WorkOSAPIClient {
  private httpClient: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string, baseURL: string = 'https://api.workos.com') {
    this.apiKey = apiKey;
    this.httpClient = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'workos-migrations-cli/1.0.0',
      },
    });
  }

  async validateApiKey(): Promise<void> {
    try {
      // Test the API key with a simple endpoint
      await this.httpClient.get('/organizations', {
        params: { limit: 1 },
      });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        throw new Error('Invalid WorkOS API key. Please check your API key and try again.');
      }
      throw new Error(
        `Failed to validate WorkOS API key: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async startCSVImport(request: WorkOSImportRequest): Promise<WorkOSImportResponse> {
    try {
      if (!fs.existsSync(request.csvFilePath)) {
        throw new Error(`CSV file not found: ${request.csvFilePath}`);
      }

      const formData = new FormData();
      formData.append('template_type', request.templateType);
      formData.append('csv_file', fs.createReadStream(request.csvFilePath));

      // Note: This endpoint doesn't exist yet, but this is the expected structure
      const response = await this.httpClient.post('/migrations/csv-import', formData, {
        headers: {
          ...formData.getHeaders(),
        },
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error(
            'CSV import endpoint not yet available. This feature is coming soon to the WorkOS API.'
          );
        }
        
        if (error.response?.data?.message) {
          throw new Error(`WorkOS API error: ${error.response.data.message}`);
        }
      }
      
      throw new Error(
        `Failed to start CSV import: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async getImportStatus(jobId: string): Promise<WorkOSImportResponse> {
    try {
      const response = await this.httpClient.get(`/migrations/csv-import/${jobId}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(
          'Import status endpoint not yet available. This feature is coming soon to the WorkOS API.'
        );
      }
      
      throw new Error(
        `Failed to get import status: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async listImportJobs(): Promise<WorkOSImportResponse[]> {
    try {
      const response = await this.httpClient.get('/migrations/csv-import');
      return response.data.data || [];
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new Error(
          'Import jobs listing endpoint not yet available. This feature is coming soon to the WorkOS API.'
        );
      }
      
      throw new Error(
        `Failed to list import jobs: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}