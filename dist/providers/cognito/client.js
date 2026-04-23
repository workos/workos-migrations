"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CognitoClient = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const workos_csv_1 = require("./workos-csv");
class CognitoClient {
    constructor(credentials, options = {}) {
        this.credentials = credentials;
        this.options = options;
    }
    async authenticate() {
        const region = this.credentials.region;
        if (!region) {
            throw new Error('AWS region is required');
        }
        this.client = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({
            region,
            credentials: this.credentials.accessKeyId && this.credentials.secretAccessKey
                ? {
                    accessKeyId: this.credentials.accessKeyId,
                    secretAccessKey: this.credentials.secretAccessKey,
                    sessionToken: this.credentials.sessionToken,
                }
                : undefined, // fall back to default AWS credential chain (env, profile, IMDS, etc.)
        });
        await this.validateCredentials();
    }
    async validateCredentials() {
        if (!this.client) {
            throw new Error('call authenticate() before validateCredentials()');
        }
        // Cheap validation that creds work + caller has some cognito permissions.
        await this.client.send(new client_cognito_identity_provider_1.ListUserPoolsCommand({ MaxResults: 1 }));
    }
    getScopes() {
        return [
            'cognito-idp:ListIdentityProviders',
            'cognito-idp:DescribeIdentityProvider',
        ];
    }
    async getAvailableEntities() {
        return [
            {
                key: 'connections',
                name: 'Connections',
                description: 'Identity providers attached to Cognito user pools (SAML + OIDC)',
                enabled: true,
            },
            {
                key: 'users',
                name: 'Users',
                description: 'Cognito user pool users (not yet implemented for export)',
                enabled: false,
            },
        ];
    }
    async exportEntities(entityTypes) {
        if (!this.client)
            throw new Error('call authenticate() before exportEntities()');
        const entities = {};
        const summary = {};
        for (const entityType of entityTypes) {
            switch (entityType) {
                case 'connections': {
                    const { providers, writtenFiles } = await this.exportConnections();
                    entities.connections = providers;
                    summary.connections = providers.length;
                    entities.output_files = writtenFiles;
                    break;
                }
                case 'users': {
                    throw new Error('users export is not yet implemented for Cognito');
                }
                default:
                    console.warn(chalk_1.default.yellow(`  skipping unknown entity: ${entityType}`));
            }
        }
        return {
            timestamp: new Date().toISOString(),
            provider: 'cognito',
            entities,
            summary,
        };
    }
    async exportConnections() {
        const poolIds = this.resolvePoolIds();
        if (poolIds.length === 0) {
            throw new Error('no user pool IDs provided — set COGNITO_USER_POOL_IDS, pass --user-pool-ids, or save to config');
        }
        const all = [];
        for (const poolId of poolIds) {
            console.log(chalk_1.default.gray(`  fetching IdPs from ${poolId}...`));
            const providers = await this.fetchProviders(poolId);
            console.log(chalk_1.default.gray(`  ${poolId}: ${providers.length} IdP(s)`));
            all.push(...providers);
        }
        const region = this.credentials.region;
        const proxy = {
            samlCustomEntityId: this.options.proxy?.samlCustomEntityId ??
                process.env.SAML_CUSTOM_ENTITY_ID_TEMPLATE ??
                workos_csv_1.DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE,
            samlCustomAcsUrl: this.options.proxy?.samlCustomAcsUrl ??
                process.env.SAML_CUSTOM_ACS_URL_TEMPLATE ??
                null,
            oidcCustomRedirectUri: this.options.proxy?.oidcCustomRedirectUri ??
                process.env.OIDC_CUSTOM_REDIRECT_URI_TEMPLATE ??
                null,
        };
        const samlRows = all.filter(workos_csv_1.isSaml).map((p) => (0, workos_csv_1.toSamlRow)(p, proxy));
        const oidcRows = all.filter(workos_csv_1.isOidc).map((p) => (0, workos_csv_1.toOidcRow)(p, proxy));
        const customAttrRows = all.flatMap(workos_csv_1.toCustomAttrRows);
        const outDir = this.options.outDir ?? process.cwd();
        fs_1.default.mkdirSync(outDir, { recursive: true });
        const samlPath = path_1.default.join(outDir, 'workos_saml_connections.csv');
        const oidcPath = path_1.default.join(outDir, 'workos_oidc_connections.csv');
        const customPath = path_1.default.join(outDir, 'custom_attribute_mappings.csv');
        fs_1.default.writeFileSync(samlPath, (0, workos_csv_1.rowsToCsv)(workos_csv_1.SAML_HEADERS, samlRows));
        fs_1.default.writeFileSync(oidcPath, (0, workos_csv_1.rowsToCsv)(workos_csv_1.OIDC_HEADERS, oidcRows));
        fs_1.default.writeFileSync(customPath, (0, workos_csv_1.rowsToCsv)(workos_csv_1.CUSTOM_ATTR_HEADERS, customAttrRows));
        console.log(chalk_1.default.blue('\n  output files:'));
        console.log(chalk_1.default.gray(`    ${samlPath}`));
        console.log(chalk_1.default.gray(`    ${oidcPath}`));
        console.log(chalk_1.default.gray(`    ${customPath}`));
        this.logWarnings(all, samlRows.length + oidcRows.length);
        // Void the unused region to keep TS happy without changing semantics
        void region;
        return {
            providers: all,
            writtenFiles: [samlPath, oidcPath, customPath],
        };
    }
    async fetchProviders(poolId) {
        const client = this.client;
        const providers = [];
        let nextToken;
        do {
            const resp = await client.send(new client_cognito_identity_provider_1.ListIdentityProvidersCommand({
                UserPoolId: poolId,
                MaxResults: 60,
                NextToken: nextToken,
            }));
            for (const summary of resp.Providers ?? []) {
                const provider = await this.describeProvider(poolId, summary);
                if (provider)
                    providers.push(provider);
            }
            nextToken = resp.NextToken;
        } while (nextToken);
        return providers;
    }
    async describeProvider(poolId, summary) {
        if (!summary.ProviderName || !summary.ProviderType)
            return null;
        const resp = await this.client.send(new client_cognito_identity_provider_1.DescribeIdentityProviderCommand({
            UserPoolId: poolId,
            ProviderName: summary.ProviderName,
        }));
        const idp = resp.IdentityProvider;
        if (!idp?.ProviderName || !idp.ProviderType)
            return null;
        return {
            userPoolId: poolId,
            providerName: idp.ProviderName,
            providerType: idp.ProviderType,
            region: this.credentials.region,
            providerDetails: (idp.ProviderDetails ?? {}),
            attributeMapping: (idp.AttributeMapping ?? {}),
            idpIdentifiers: idp.IdpIdentifiers ?? [],
        };
    }
    resolvePoolIds() {
        const candidates = this.options.userPoolIds ??
            (this.credentials.userPoolIds
                ? this.credentials.userPoolIds.split(',')
                : this.credentials.userPoolId
                    ? [this.credentials.userPoolId]
                    : []);
        return candidates.map((s) => s.trim()).filter(Boolean);
    }
    logWarnings(all, totalRows) {
        const nameOnly = all.filter((p) => (0, workos_csv_1.isSaml)(p) &&
            p.attributeMapping.name &&
            !(p.attributeMapping.given_name && p.attributeMapping.family_name));
        if (nameOnly.length > 0) {
            console.log(chalk_1.default.yellow(`  [warn] ${nameOnly.length} SAML connection(s) rely on a full-name attribute only ` +
                `(no given_name/family_name). WorkOS will use the 'name' column at import.`));
        }
        if (totalRows > 0) {
            console.log(chalk_1.default.yellow(`  [warn] ${totalRows} row(s) have empty 'domains' column. ` +
                `Optional per WorkOS, recommended for domain-capture — populate before uploading.`));
        }
    }
}
exports.CognitoClient = CognitoClient;
//# sourceMappingURL=client.js.map