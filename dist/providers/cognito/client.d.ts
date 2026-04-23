import { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../types';
import { ProxyTemplates } from './workos-csv';
export interface CognitoClientOptions {
    /** Comma-separated pool IDs or a single ID. Overrides the USER_POOL_IDS credential. */
    userPoolIds?: string[];
    /** Directory to write CSV output. Defaults to cwd. */
    outDir?: string;
    /** Proxy URL templates with {provider_name}, {user_pool_id}, {region} placeholders. */
    proxy?: ProxyTemplates;
}
export declare class CognitoClient implements ProviderClient {
    private client?;
    private readonly credentials;
    private readonly options;
    constructor(credentials: ProviderCredentials, options?: CognitoClientOptions);
    authenticate(): Promise<void>;
    validateCredentials(): Promise<void>;
    getScopes(): string[];
    getAvailableEntities(): Promise<EntityType[]>;
    exportEntities(entityTypes: string[]): Promise<ExportResult>;
    private exportConnections;
    private exportUsers;
    private fetchUsers;
    private mapUser;
    private logUserWarnings;
    private fetchProviders;
    private describeProvider;
    private resolvePoolIds;
    private logWarnings;
}
//# sourceMappingURL=client.d.ts.map