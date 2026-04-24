import type { Auth0User, Auth0Organization } from '../../shared/types.js';
export interface Auth0ClientOptions {
    domain: string;
    clientId: string;
    clientSecret: string;
    rateLimit?: number;
}
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
    getOrganizationMembers(orgId: string, page?: number, perPage?: number): Promise<Array<{
        user_id: string;
    }>>;
    getUser(userId: string): Promise<Auth0User | null>;
    getUsers(page?: number, perPage?: number): Promise<Auth0User[]>;
    testConnection(): Promise<{
        success: boolean;
        error?: string;
    }>;
}
