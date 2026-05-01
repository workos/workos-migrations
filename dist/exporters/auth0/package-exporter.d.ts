import type { Auth0ExportOptions, Auth0Organization, Auth0User, ExportSummary } from '../../shared/types.js';
export interface Auth0ExportClient {
    testConnection?(): Promise<{
        success: boolean;
        error?: string;
    }>;
    getOrganizations(page?: number, perPage?: number): Promise<Auth0Organization[]>;
    getOrganizationMembers(orgId: string, page?: number, perPage?: number): Promise<Array<{
        user_id: string;
    }>>;
    getUser(userId: string): Promise<Auth0User | null>;
    getUsers(page?: number, perPage?: number): Promise<Auth0User[]>;
}
export declare function exportAuth0Package(options: Auth0ExportOptions): Promise<ExportSummary>;
export declare function exportAuth0PackageWithClient(client: Auth0ExportClient, options: Auth0ExportOptions): Promise<ExportSummary>;
