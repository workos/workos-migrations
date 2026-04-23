"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformAuth0Connections = transformAuth0Connections;
exports.ensureWellKnown = ensureWellKnown;
exports.ensureHttps = ensureHttps;
const csv_1 = require("../../shared/csv");
const DEFAULT_ORG_NAME_PREFIX = '[MIGRATED] sso-';
function transformAuth0Connections(connections, config) {
    const orgNamePrefix = config.organizationNamePrefix ?? DEFAULT_ORG_NAME_PREFIX;
    const samlRows = [];
    const oidcRows = [];
    const samlIdpInitiatedDisabled = [];
    const skipped = [];
    const manualSetup = [];
    for (const connection of connections) {
        const row = {
            organizationName: `${orgNamePrefix}${connection.name}`,
            organizationExternalId: connection.name,
            importedId: connection.name,
        };
        if (!connection.enabled_clients || connection.enabled_clients.length === 0) {
            const connectionType = connection.strategy === 'samlp' ? 'SAML' : 'OIDC';
            skipped.push({
                connectionName: connection.name,
                reason: 'No applications enabled',
                type: connectionType,
            });
            continue;
        }
        switch (connection.strategy) {
            case 'samlp':
                processSaml(connection, row, config, samlRows, samlIdpInitiatedDisabled);
                break;
            case 'oidc':
                processOidc(connection, row, config, oidcRows, skipped);
                break;
            case 'waad':
                processWaad(connection, row, config, oidcRows, skipped);
                break;
            case 'adfs':
                processAdfs(connection, row, config, samlRows);
                break;
            case 'pingfederate':
                processPingFederate(connection, row, config, samlRows);
                break;
            case 'google-apps':
                processGoogleApps(connection, row, config, oidcRows);
                manualSetup.push({
                    connectionName: connection.name,
                    strategy: connection.strategy,
                    reason: 'Imported without client_secret — must be added manually in WorkOS after import',
                });
                break;
            case 'ad':
            case 'auth0-adldap':
                manualSetup.push({
                    connectionName: connection.name,
                    strategy: connection.strategy,
                    reason: 'On-prem AD/LDAP connector — no automated migration path, requires manual setup',
                });
                break;
            default:
                manualSetup.push({
                    connectionName: connection.name,
                    strategy: connection.strategy,
                    reason: `Unrecognized strategy "${connection.strategy}" — requires manual review`,
                });
                break;
        }
    }
    return {
        samlCsv: (0, csv_1.createCSV)(csv_1.SAML_HEADERS, samlRows),
        oidcCsv: (0, csv_1.createCSV)(csv_1.OIDC_HEADERS, oidcRows),
        samlCount: samlRows.length,
        oidcCount: oidcRows.length,
        skipped,
        manualSetup,
        samlIdpInitiatedDisabled,
    };
}
function buildSamlRow(connection, common, overrides, config) {
    const customEntityId = config.entityIdPrefix
        ? `${config.entityIdPrefix}${connection.name}`
        : '';
    const customAcsUrl = config.customDomain
        ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
        : '';
    return (0, csv_1.createCSVRow)([
        common.organizationName, // organizationName
        '', // organizationId
        common.organizationExternalId, // organizationExternalId
        '', // domains
        '', // idpEntityId
        overrides.idpUrl ?? '', // idpUrl
        overrides.x509Cert ?? '', // x509Cert
        overrides.idpMetadataUrl ?? '', // idpMetadataUrl
        customEntityId, // customEntityId
        customAcsUrl, // customAcsUrl
        overrides.idpIdAttribute ?? '', // idpIdAttribute
        overrides.emailAttribute ?? '', // emailAttribute
        overrides.firstNameAttribute ?? '', // firstNameAttribute
        overrides.lastNameAttribute ?? '', // lastNameAttribute
        '', // name
        '', // customAttributes
        overrides.idpInitiatedEnabled ?? 'false', // idpInitiatedEnabled
        '', // requestSigningKey
        '', // assertionEncryptionKey
        '', // nameIdEncryptionKey
        common.importedId, // importedId
    ]);
}
function buildOidcRow(common, fields, config) {
    const customRedirectUri = config.customDomain
        ? `https://${config.customDomain}/login/callback`
        : '';
    return (0, csv_1.createCSVRow)([
        common.organizationName, // organizationName
        '', // organizationId
        common.organizationExternalId, // organizationExternalId
        '', // domains
        fields.clientId ?? '', // clientId
        fields.clientSecret ?? '', // clientSecret
        fields.discoveryEndpoint, // discoveryEndpoint
        customRedirectUri, // customRedirectUri
        '', // name
        '', // customAttributes
        common.importedId, // importedId
    ]);
}
function firstOf(value) {
    if (Array.isArray(value))
        return value[0] ?? '';
    return value ?? '';
}
function processSaml(connection, common, config, samlRows, samlIdpInitiatedDisabled) {
    const options = connection.options || {};
    const rawFieldsMap = options.fieldsMap || {};
    const attributeMapping = {
        id: firstOf(rawFieldsMap.id),
        email: firstOf(rawFieldsMap.email),
        given_name: firstOf(rawFieldsMap.given_name),
        family_name: firstOf(rawFieldsMap.family_name),
    };
    samlRows.push(buildSamlRow(connection, common, {
        idpUrl: options.signInEndpoint,
        x509Cert: options.cert,
        idpIdAttribute: attributeMapping.id,
        emailAttribute: attributeMapping.email,
        firstNameAttribute: attributeMapping.given_name,
        lastNameAttribute: attributeMapping.family_name,
        idpInitiatedEnabled: options.idpinitiated?.enabled ? 'true' : 'false',
    }, config));
    if (!options.idpinitiated?.enabled) {
        samlIdpInitiatedDisabled.push(connection.name);
    }
}
function processOidc(connection, common, config, oidcRows, skipped) {
    const options = connection.options || {};
    if (options.type !== 'back_channel') {
        skipped.push({
            connectionName: connection.name,
            reason: 'OIDC connection is not a back_channel connection',
            type: 'OIDC',
        });
        return;
    }
    const rawDiscovery = options.discovery_url || options.oidc_metadata?.issuer || options.issuer;
    if (!rawDiscovery) {
        skipped.push({
            connectionName: connection.name,
            reason: 'No discovery endpoint found',
            type: 'OIDC',
        });
        return;
    }
    const discoveryEndpoint = ensureHttps(ensureWellKnown(rawDiscovery));
    try {
        new URL(discoveryEndpoint);
    }
    catch {
        skipped.push({
            connectionName: connection.name,
            reason: 'Invalid discovery endpoint',
            type: 'OIDC',
        });
        return;
    }
    oidcRows.push(buildOidcRow(common, {
        clientId: options.client_id,
        clientSecret: options.client_secret,
        discoveryEndpoint,
    }, config));
}
function processWaad(connection, common, config, oidcRows, skipped) {
    const options = connection.options || {};
    const tenantDomain = options.tenant_domain || options.domain;
    if (!tenantDomain) {
        skipped.push({
            connectionName: connection.name,
            reason: 'Azure AD connection missing tenant domain',
            type: 'OIDC',
        });
        return;
    }
    const discoveryEndpoint = `https://login.microsoftonline.com/${tenantDomain}/.well-known/openid-configuration`;
    oidcRows.push(buildOidcRow(common, {
        clientId: options.client_id,
        clientSecret: options.client_secret,
        discoveryEndpoint,
    }, config));
}
function processGoogleApps(connection, common, config, oidcRows) {
    const options = connection.options || {};
    oidcRows.push(buildOidcRow(common, {
        clientId: options.client_id,
        clientSecret: '', // not available from Auth0 API for google-apps
        discoveryEndpoint: 'https://accounts.google.com/.well-known/openid-configuration',
    }, config));
}
function processAdfs(connection, common, config, samlRows) {
    const options = connection.options || {};
    samlRows.push(buildSamlRow(connection, common, {
        idpMetadataUrl: options.adfs_server,
        idpInitiatedEnabled: 'false',
    }, config));
}
function processPingFederate(connection, common, config, samlRows) {
    const options = connection.options || {};
    samlRows.push(buildSamlRow(connection, common, {
        idpUrl: options.pingfederate_base_url,
        x509Cert: options.signing_cert || options.signingCert,
        idpInitiatedEnabled: options.idpinitiated?.enabled ? 'true' : 'false',
    }, config));
}
// ---------------------------------------------------------------------------
// URL normalization helpers
// ---------------------------------------------------------------------------
function ensureWellKnown(url) {
    const suffix = '/.well-known/openid-configuration';
    const trimmed = url.replace(/\/+$/, '');
    return trimmed.endsWith(suffix) ? trimmed : trimmed + suffix;
}
function ensureHttps(url) {
    if (url.startsWith('https://'))
        return url;
    if (url.startsWith('http://'))
        return 'https://' + url.slice('http://'.length);
    return 'https://' + url;
}
//# sourceMappingURL=transform.js.map