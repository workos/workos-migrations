import type { Auth0Connection, Auth0ExportOptions, Auth0Organization, Auth0OrganizationConnection, Auth0Role, Auth0User, ExportSummary } from '../../shared/types.js';
import { type BulkExportClient } from './bulk-export.js';
export interface Auth0ExportClient extends Partial<BulkExportClient> {
    testConnection?(): Promise<{
        success: boolean;
        error?: string;
    }>;
    getConnections?(page?: number, perPage?: number, strategy?: string | string[]): Promise<Auth0Connection[]>;
    getConnection?(connectionId: string): Promise<Auth0Connection>;
    getOrganizations(page?: number, perPage?: number): Promise<Auth0Organization[]>;
    getOrganizationConnections?(orgId: string, page?: number, perPage?: number): Promise<Auth0OrganizationConnection[]>;
    getOrganizationMembers(orgId: string, page?: number, perPage?: number): Promise<Array<{
        user_id: string;
    }>>;
    getUser(userId: string): Promise<Auth0User | null>;
    getUsers(page?: number, perPage?: number): Promise<Auth0User[]>;
    getRoles?(page?: number, perPage?: number): Promise<Auth0Role[]>;
    getMemberRoles?(orgId: string, userId: string, page?: number, perPage?: number): Promise<Auth0Role[]>;
}
export declare function exportAuth0Package(options: Auth0ExportOptions): Promise<ExportSummary>;
export declare function exportAuth0PackageWithClient(client: Auth0ExportClient, options: Auth0ExportOptions): Promise<ExportSummary>;
