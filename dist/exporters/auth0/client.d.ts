import type { Auth0Connection, Auth0Job, Auth0Organization, Auth0OrganizationConnection, Auth0Role, Auth0User, Auth0UserExportJobOptions } from '../../shared/types.js';
export interface Auth0ClientOptions {
    domain: string;
    clientId: string;
    clientSecret: string;
    rateLimit?: number;
}
export declare class Auth0ApiError extends Error {
    statusCode: number;
    body: string;
    path: string;
    constructor(statusCode: number, body: string, path: string);
}
export declare function isMissingConnectionOptionsScopeError(error: unknown): boolean;
export declare class Auth0Client {
    private domain;
    private clientId;
    private clientSecret;
    private rateLimiter;
    private accessToken?;
    private tokenExpiry?;
    constructor(options: Auth0ClientOptions);
    getAccessToken(): Promise<string>;
    private apiCall;
    private retryWithRateLimit;
    getOrganizations(page?: number, perPage?: number): Promise<Auth0Organization[]>;
    getConnections(page?: number, perPage?: number, strategy?: string | string[]): Promise<Auth0Connection[]>;
    getConnection(connectionId: string): Promise<Auth0Connection>;
    getOrganizationConnections(orgId: string, page?: number, perPage?: number): Promise<Auth0OrganizationConnection[]>;
    getOrganizationMembers(orgId: string, page?: number, perPage?: number): Promise<Array<{
        user_id: string;
    }>>;
    getUser(userId: string): Promise<Auth0User | null>;
    getUsers(page?: number, perPage?: number): Promise<Auth0User[]>;
    getMemberRoles(orgId: string, userId: string, page?: number, perPage?: number): Promise<Auth0Role[]>;
    getRoles(page?: number, perPage?: number): Promise<Auth0Role[]>;
    createUserExportJob(options?: Auth0UserExportJobOptions): Promise<Auth0Job>;
    getJob(jobId: string): Promise<Auth0Job>;
    downloadJobLocation(location: string): Promise<string>;
    testConnection(): Promise<{
        success: boolean;
        error?: string;
    }>;
}
