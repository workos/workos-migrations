import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../types';
import { getAllTemplates, getTemplate, generateTemplateExample } from './templates';
import { CSVValidator } from './validator';
import { WorkOSAPIClient, WorkOSImportRequest } from './workos-api';

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

export class CSVClient implements ProviderClient {
  private workosClient: WorkOSAPIClient;

  constructor(private credentials: ProviderCredentials) {
    if (!credentials.workosApiKey) {
      throw new Error('WorkOS API key is required for CSV imports');
    }
    
    this.workosClient = new WorkOSAPIClient(credentials.workosApiKey);
  }

  async authenticate(): Promise<void> {
    await this.workosClient.validateApiKey();
  }

  async validateCredentials(): Promise<void> {
    await this.authenticate();
  }

  async getAvailableEntities(): Promise<EntityType[]> {
    const templates = getAllTemplates();
    
    return templates.map(template => ({
      key: template.name.toLowerCase().replace(/\s+/g, '_'),
      name: template.name,
      description: template.description,
      enabled: true,
    }));
  }

  async exportEntities(entityTypes: string[]): Promise<ExportResult> {
    // CSV provider doesn't export - it imports
    throw new Error('CSV provider is for importing data to WorkOS, not exporting');
  }

  async importCSV(request: CSVImportRequest): Promise<CSVImportResult> {
    const template = getTemplate(request.templateType);
    if (!template) {
      return {
        success: false,
        message: `Unknown template type: ${request.templateType}`,
      };
    }

    // Validate the CSV file
    console.log(chalk.blue('📋 Validating CSV file...'));
    const validationResult = await CSVValidator.validateFile(
      request.csvFilePath,
      request.templateType
    );

    if (!validationResult.valid) {
      return {
        success: false,
        validationResult,
        message: `CSV validation failed: ${validationResult.errors.join(', ')}`,
      };
    }

    console.log(chalk.green(`✓ CSV validation passed: ${validationResult.validRows}/${validationResult.totalRows} rows valid`));

    if (validationResult.warnings.length > 0) {
      console.log(chalk.yellow('⚠️  Warnings:'));
      validationResult.warnings.forEach(warning => {
        console.log(chalk.yellow(`   • ${warning}`));
      });
    }

    if (request.validateOnly) {
      return {
        success: true,
        validationResult,
        message: 'CSV validation completed successfully',
      };
    }

    // Start the import process
    console.log(chalk.blue('🚀 Starting import to WorkOS...'));
    
    try {
      const importResponse = await this.workosClient.startCSVImport({
        templateType: request.templateType,
        csvFilePath: request.csvFilePath,
      });

      return {
        success: true,
        jobId: importResponse.jobId,
        validationResult,
        message: `Import started successfully. Job ID: ${importResponse.jobId}`,
      };
    } catch (error) {
      return {
        success: false,
        validationResult,
        message: error instanceof Error ? error.message : 'Unknown error during import',
      };
    }
  }

  async getImportStatus(jobId: string): Promise<any> {
    return await this.workosClient.getImportStatus(jobId);
  }

  async listImportJobs(): Promise<any[]> {
    return await this.workosClient.listImportJobs();
  }

  generateTemplate(templateType: string, outputPath?: string): string {
    const template = getTemplate(templateType);
    if (!template) {
      throw new Error(`Template ${templateType} not found`);
    }

    const content = generateTemplateExample(templateType);
    const filename = outputPath || template.filename;
    
    fs.writeFileSync(filename, content);
    return filename;
  }

  getTemplateInfo(templateType: string): any {
    const template = getTemplate(templateType);
    if (!template) {
      throw new Error(`Template ${templateType} not found`);
    }

    return {
      name: template.name,
      description: template.description,
      filename: template.filename,
      required_columns: template.required,
      optional_columns: template.optional,
      example: template.example,
      schema: {
        headers: template.headers,
        required: template.required,
        optional: template.optional,
      },
    };
  }
}