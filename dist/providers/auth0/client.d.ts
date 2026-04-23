import { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../types';
import { type Auth0TransformConfig } from './transform';
export interface Auth0User {
    user_id: string;
    email: string;
    name: string;
    created_at: string;
    updated_at: string;
    [key: string]: any;
}
export interface Auth0Connection {
    id: string;
    name: string;
    strategy: string;
    display_name: string;
    enabled_clients: string[];
    options: any;
    [key: string]: any;
}
export interface Auth0Client {
    client_id: string;
    name: string;
    app_type: string;
    is_first_party: boolean;
    callbacks: string[];
    [key: string]: any;
}
export interface Auth0Role {
    id: string;
    name: string;
    description: string;
    [key: string]: any;
}
export interface Auth0Organization {
    id: string;
    name: string;
    display_name: string;
    [key: string]: any;
}
export declare class Auth0Client implements ProviderClient {
    private credentials;
    private transformConfig;
    private outputDir?;
    private httpClient;
    private accessToken;
    private grantedScopes;
    private static readonly SCOPE_REQUIREMENTS;
    constructor(credentials: ProviderCredentials, transformConfig?: Auth0TransformConfig, outputDir?: string | undefined);
    authenticate(): Promise<void>;
    validateCredentials(): Promise<void>;
    getScopes(): string[];
    getAvailableEntities(): Promise<EntityType[]>;
    private hasRequiredScopes;
    exportEntities(entityTypes: string[]): Promise<ExportResult>;
    private writeUsersCsv;
    private printUserSummary;
    private writeTransformOutputs;
    private printTransformSummary;
    private getUsers;
    private getConnections;
    private getClients;
    private getRoles;
    private getOrganizations;
}
