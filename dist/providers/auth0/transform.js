"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformAuth0Connections = transformAuth0Connections;
const csv_1 = require("../../shared/csv");
const DEFAULT_ORG_NAME_PREFIX = '[MIGRATED] sso-';
function transformAuth0Connections(connections, clients, config) {
    const bookmarkSlugMap = config.bookmarkSlugMap ?? {};
    const orgNamePrefix = config.organizationNamePrefix ?? DEFAULT_ORG_NAME_PREFIX;
    const samlRows = [];
    const oidcRows = [];
    const samlIdpInitiatedDisabled = [];
    const skipped = [];
    const manualSetup = [];
    for (const connection of connections) {
        const bookmarks = (connection.enabled_clients ?? [])
            .map((clientId) => bookmarkSlugMap[clientId])
            .filter(Boolean);
        const uniqueBookmarks = [...new Set(bookmarks)];
        const commonRow = [
            `${orgNamePrefix}${connection.name}`, // organizationName
            '', // organizationId
            connection.name, // organizationExternalId
            '', // domains
            connection.name, // importedId
            JSON.stringify(uniqueBookmarks), // connectionBookmarks
        ];
        if (bookmarks.length === 0) {
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
                processSaml(connection, commonRow, config, samlRows, samlIdpInitiatedDisabled);
                break;
            case 'oidc':
                processOidc(connection, commonRow, config, oidcRows, skipped);
                break;
            case 'waad':
                processWaad(connection, commonRow, config, oidcRows, skipped);
                break;
            case 'adfs':
                processAdfs(connection, commonRow, config, samlRows);
                break;
            case 'pingfederate':
                processPingFederate(connection, commonRow, config, samlRows);
                break;
            case 'google-apps':
                processGoogleApps(connection, commonRow, config, oidcRows);
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
// ---------------------------------------------------------------------------
// Strategy-specific processors
// ---------------------------------------------------------------------------
function processSaml(connection, commonRow, config, samlRows, samlIdpInitiatedDisabled) {
    const options = connection.options || {};
    const rawFieldsMap = options.fieldsMap || {};
    const firstOf = (v) => {
        if (Array.isArray(v))
            return v[0] ?? '';
        return v ?? '';
    };
    const attributeMapping = {
        id: firstOf(rawFieldsMap.id),
        email: firstOf(rawFieldsMap.email),
        given_name: firstOf(rawFieldsMap.given_name),
        family_name: firstOf(rawFieldsMap.family_name),
    };
    const defaultIdpInitClient = options.idpinitiated?.client_id;
    const defaultBookmarkForIdpInit = (defaultIdpInitClient && config.bookmarkSlugMap?.[defaultIdpInitClient]) || '';
    const customEntityId = config.entityIdPrefix
        ? `${config.entityIdPrefix}${connection.name}`
        : '';
    const customAcsUrl = config.customDomain
        ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
        : '';
    samlRows.push((0, csv_1.createCSVRow)([
        ...commonRow,
        '', // idpEntityId
        options.signInEndpoint || '', // idpUrl
        options.cert || '', // x509Cert
        attributeMapping.id || '', // idpIdAttribute
        attributeMapping.email || '', // emailAttribute
        attributeMapping.given_name || '', // firstNameAttribute
        attributeMapping.family_name || '', // lastNameAttribute
        '', // name
        '', // customAttributes
        '', // idpMetadataUrl
        customEntityId,
        customAcsUrl,
        options.idpinitiated?.enabled ? 'true' : 'false', // idpInitiatedSsoEnabled
        defaultBookmarkForIdpInit, // defaultConnectionBookmarkForIdpInitiatedSso
    ]));
    if (!options.idpinitiated?.enabled) {
        samlIdpInitiatedDisabled.push(connection.name);
    }
}
function processOidc(connection, commonRow, config, oidcRows, skipped) {
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
    const customRedirectUri = config.customDomain
        ? `https://${config.customDomain}/login/callback`
        : '';
    oidcRows.push((0, csv_1.createCSVRow)([
        ...commonRow,
        options.client_id || '', // clientId
        options.client_secret || '', // clientSecret
        discoveryEndpoint, // discoveryEndpoint
        customRedirectUri, // customRedirectUri
        '', // name
        '', // customAttributes
    ]));
}
function processWaad(connection, commonRow, config, oidcRows, skipped) {
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
    const customRedirectUri = config.customDomain
        ? `https://${config.customDomain}/login/callback`
        : '';
    oidcRows.push((0, csv_1.createCSVRow)([
        ...commonRow,
        options.client_id || '',
        options.client_secret || '',
        discoveryEndpoint,
        customRedirectUri,
        '', // name
        '', // customAttributes
    ]));
}
function processGoogleApps(connection, commonRow, config, oidcRows) {
    const options = connection.options || {};
    const discoveryEndpoint = 'https://accounts.google.com/.well-known/openid-configuration';
    const customRedirectUri = config.customDomain
        ? `https://${config.customDomain}/login/callback`
        : '';
    oidcRows.push((0, csv_1.createCSVRow)([
        ...commonRow,
        options.client_id || '',
        '', // clientSecret — not available from Auth0 API for google-apps
        discoveryEndpoint,
        customRedirectUri,
        '', // name
        '', // customAttributes
    ]));
}
function processAdfs(connection, commonRow, config, samlRows) {
    const options = connection.options || {};
    const customEntityId = config.entityIdPrefix
        ? `${config.entityIdPrefix}${connection.name}`
        : '';
    const customAcsUrl = config.customDomain
        ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
        : '';
    samlRows.push((0, csv_1.createCSVRow)([
        ...commonRow,
        '', // idpEntityId
        '', // idpUrl
        '', // x509Cert
        '', // idpIdAttribute
        '', // emailAttribute
        '', // firstNameAttribute
        '', // lastNameAttribute
        '', // name
        '', // customAttributes
        options.adfs_server || '', // idpMetadataUrl
        customEntityId,
        customAcsUrl,
        'false', // idpInitiatedSsoEnabled
        '', // defaultConnectionBookmarkForIdpInitiatedSso
    ]));
}
function processPingFederate(connection, commonRow, config, samlRows) {
    const options = connection.options || {};
    const customEntityId = config.entityIdPrefix
        ? `${config.entityIdPrefix}${connection.name}`
        : '';
    const customAcsUrl = config.customDomain
        ? `https://${config.customDomain}/login/callback?connection=${connection.name}`
        : '';
    samlRows.push((0, csv_1.createCSVRow)([
        ...commonRow,
        '', // idpEntityId
        options.pingfederate_base_url || '', // idpUrl
        options.signing_cert || options.signingCert || '', // x509Cert
        '', // idpIdAttribute
        '', // emailAttribute
        '', // firstNameAttribute
        '', // lastNameAttribute
        '', // name
        '', // customAttributes
        '', // idpMetadataUrl
        customEntityId,
        customAcsUrl,
        options.idpinitiated?.enabled ? 'true' : 'false',
        '',
    ]));
}
// ---------------------------------------------------------------------------
// Helpers
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