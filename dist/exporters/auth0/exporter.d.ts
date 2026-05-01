import type { Auth0ExportOptions, ExportSummary } from '../../shared/types.js';
import { type Auth0ExportClient } from './package-exporter.js';
export declare function exportAuth0(options: Auth0ExportOptions): Promise<ExportSummary>;
export declare function exportAuth0CsvWithClient(client: Auth0ExportClient, options: Auth0ExportOptions): Promise<ExportSummary>;
