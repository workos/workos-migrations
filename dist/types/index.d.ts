export interface ProviderCredentials {
    [key: string]: string;
}
export interface Provider {
    name: string;
    displayName: string;
    credentials: CredentialField[];
    entities: EntityType[];
}
export interface CredentialField {
    key: string;
    name: string;
    type: 'input' | 'password';
    required: boolean;
    envVar?: string;
}
export interface EntityType {
    key: string;
    name: string;
    description: string;
    enabled: boolean;
}
export interface ProviderClient {
    authenticate(): Promise<void>;
    getAvailableEntities(): Promise<EntityType[]>;
    exportEntities(entities: string[]): Promise<ExportResult>;
    validateCredentials(): Promise<void>;
    getScopes?(): string[];
}
export interface ExportResult {
    timestamp: string;
    provider: string;
    entities: Record<string, any[]>;
    summary: {
        [entityType: string]: number;
    };
}
export interface Config {
    providers: {
        [providerName: string]: ProviderCredentials;
    };
}
//# sourceMappingURL=index.d.ts.map