import type { ProviderClient, EntityType, ExportResult, ProviderCredentials } from '../../shared/types.js';
import { type ProxyTemplates } from './workos-csv.js';
export interface CognitoClientOptions {
    /** Comma-separated pool IDs or a single ID. Overrides the USER_POOL_IDS credential. */
    userPoolIds?: string[];
    /** Directory to write CSV output. Defaults to cwd. */
    outDir?: string;
    /** Proxy URL templates with {provider_name}, {user_pool_id}, {region} placeholders. */
    proxy?: ProxyTemplates;
    /**
     * Skip Cognito users whose `userStatus` is `EXTERNAL_PROVIDER` (federated SAML/OIDC/social
     * identities). WorkOS will JIT-provision them on first SSO login, so importing them
     * up-front creates a shell record that JIT later shadows or dedupes against. Off by default
     * — most migrations want the metadata in WorkOS immediately for analytics/lookup.
     */
    skipExternalProviderUsers?: boolean;
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
