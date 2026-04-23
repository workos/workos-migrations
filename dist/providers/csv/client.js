"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSVClient = void 0;
const fs_1 = __importDefault(require("fs"));
const chalk_1 = __importDefault(require("chalk"));
const templates_1 = require("./templates");
const validator_1 = require("./validator");
const workos_api_1 = require("./workos-api");
class CSVClient {
    constructor(credentials) {
        this.credentials = credentials;
        if (!credentials.workosApiKey) {
            throw new Error('WorkOS API key is required for CSV imports');
        }
        this.workosClient = new workos_api_1.WorkOSAPIClient(credentials.workosApiKey);
    }
    async authenticate() {
        await this.workosClient.validateApiKey();
    }
    async validateCredentials() {
        await this.authenticate();
    }
    async getAvailableEntities() {
        const templates = (0, templates_1.getAllTemplates)();
        return templates.map((template) => ({
            key: template.name.toLowerCase().replace(/\s+/g, '_'),
            name: template.name,
            description: template.description,
            enabled: true,
        }));
    }
    async exportEntities(entityTypes) {
        // CSV provider doesn't export - it imports
        throw new Error('CSV provider is for importing data to WorkOS, not exporting');
    }
    async importCSV(request) {
        const template = (0, templates_1.getTemplate)(request.templateType);
        if (!template) {
            return {
                success: false,
                message: `Unknown template type: ${request.templateType}`,
            };
        }
        // Validate the CSV file
        console.log(chalk_1.default.blue('📋 Validating CSV file...'));
        const validationResult = await validator_1.CSVValidator.validateFile(request.csvFilePath, request.templateType);
        if (!validationResult.valid) {
            return {
                success: false,
                validationResult,
                message: `CSV validation failed: ${validationResult.errors.join(', ')}`,
            };
        }
        console.log(chalk_1.default.green(`✓ CSV validation passed: ${validationResult.validRows}/${validationResult.totalRows} rows valid`));
        if (validationResult.warnings.length > 0) {
            console.log(chalk_1.default.yellow('⚠️  Warnings:'));
            validationResult.warnings.forEach((warning) => {
                console.log(chalk_1.default.yellow(`   • ${warning}`));
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
        console.log(chalk_1.default.blue('🚀 Starting import to WorkOS...'));
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
        }
        catch (error) {
            return {
                success: false,
                validationResult,
                message: error instanceof Error ? error.message : 'Unknown error during import',
            };
        }
    }
    async getImportStatus(jobId) {
        return await this.workosClient.getImportStatus(jobId);
    }
    async listImportJobs() {
        return await this.workosClient.listImportJobs();
    }
    generateTemplate(templateType, outputPath) {
        const template = (0, templates_1.getTemplate)(templateType);
        if (!template) {
            throw new Error(`Template ${templateType} not found`);
        }
        const content = (0, templates_1.generateTemplateExample)(templateType);
        const filename = outputPath || template.filename;
        fs_1.default.writeFileSync(filename, content);
        return filename;
    }
    getTemplateInfo(templateType) {
        const template = (0, templates_1.getTemplate)(templateType);
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
exports.CSVClient = CSVClient;
