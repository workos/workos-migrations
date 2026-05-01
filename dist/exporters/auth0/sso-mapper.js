import { createCustomAttributeMappingRow, createOidcConnectionRow, createProxyRouteRow, createSamlConnectionRow, incompleteConnectionConfigurationWarning, missingDomainsWarning, multiOrgConnectionConsolidationWarning, redactedSecretsWarning, unsupportedConnectionProtocolWarning, } from '../../sso/handoff.js';
import { normalizeDiscoveryEndpoint, parseSamlMetadata } from '../../sso/saml-metadata.js';
export const AUTH0_REDACTED_SECRET_FIELDS = [
    'client_secret',
    'clientSecret',
    'secret',
    'password',
    'private_key',
    'privateKey',
    'requestSigningKey',
    'assertionEncryptionKey',
    'nameIdEncryptionKey',
    'access_token',
    'refresh_token',
    'id_token',
];
const SAML_XML_OPTION_KEYS = [
    'metadataXml',
    'metadataXML',
    'metadataFile',
    'metadata_file',
    'idpMetadataXml',
    'idp_metadata_xml',
];
const SAML_METADATA_URL_KEYS = [
    'metadataUrl',
    'metadataURL',
    'metadata_url',
    'idpMetadataUrl',
    'idp_metadata_url',
    'MetadataURL',
];
const SAML_IDP_ENTITY_ID_KEYS = [
    'idpEntityId',
    'idp_entity_id',
    'entityId',
    'entityID',
    'issuer',
    'idpIssuer',
];
const SAML_IDP_URL_KEYS = [
    'signInEndpoint',
    'signin_url',
    'signInUrl',
    'ssoUrl',
    'sso_url',
    'idpUrl',
    'idp_url',
    'SSORedirectBindingURI',
];
const SAML_CERT_KEYS = [
    'signingCert',
    'signing_cert',
    'x509Cert',
    'x509cert',
    'x509_certificate',
    'cert',
    'certificate',
];
const SAML_SP_ENTITY_ID_KEYS = [
    'audience',
    'spEntityId',
    'sp_entity_id',
    'serviceProviderEntityId',
];
const SAML_ACS_URL_KEYS = [
    'callbackUrl',
    'callbackURL',
    'acsUrl',
    'acs_url',
    'recipient',
    'destination',
];
const SAML_SECRET_KEYS = [
    'requestSigningKey',
    'request_signing_key',
    'assertionEncryptionKey',
    'assertion_encryption_key',
    'nameIdEncryptionKey',
    'name_id_encryption_key',
];
const OIDC_CLIENT_ID_KEYS = ['client_id', 'clientId'];
const OIDC_CLIENT_SECRET_KEYS = ['client_secret', 'clientSecret'];
const OIDC_DISCOVERY_KEYS = [
    'discoveryEndpoint',
    'discovery_endpoint',
    'discoveryUrl',
    'discovery_url',
    'issuer',
    'issuerUrl',
    'issuer_url',
];
const OIDC_REDIRECT_URI_KEYS = [
    'redirectUri',
    'redirect_uri',
    'callbackUrl',
    'callbackURL',
];
const ATTRIBUTE_MAPPING_KEYS = [
    'fieldsMap',
    'fieldMap',
    'fields_map',
    'mapping',
    'attributeMap',
    'attribute_map',
    'attributes',
    'profileMap',
    'profile_map',
];
const COMMON_PROFILE_ATTRIBUTES = new Set([
    'email',
    'given_name',
    'family_name',
    'first_name',
    'last_name',
    'name',
    'nickname',
    'picture',
    'user_id',
    'sub',
]);
const REDACTED_VALUE = '[REDACTED]';
export function classifyAuth0ConnectionProtocol(connection) {
    const strategy = connection.strategy.toLowerCase();
    if (strategy === 'samlp')
        return 'saml';
    if (strategy === 'oidc')
        return 'oidc';
    return 'unsupported';
}
export function buildAuth0ConnectionImportedId(connection) {
    return `auth0:${connection.id}`;
}
export function mapAuth0ConnectionToSsoHandoff(input) {
    const { connection } = input;
    const importedId = buildAuth0ConnectionImportedId(connection);
    const protocol = classifyAuth0ConnectionProtocol(connection);
    if (protocol === 'unsupported') {
        const warning = unsupportedConnectionProtocolWarning({
            provider: 'auth0',
            protocol: connection.strategy || 'unknown',
            importedId,
            strategy: connection.strategy,
            reason: 'Only Auth0 samlp and oidc enterprise connections are supported for WorkOS SSO handoff.',
        });
        return {
            status: 'skipped',
            protocol,
            importedId,
            reason: 'unsupported_connection_protocol',
            warnings: [warning],
        };
    }
    if (protocol === 'saml') {
        return mapSamlConnection(input, importedId);
    }
    return mapOidcConnection(input, importedId);
}
export function redactAuth0ConnectionSecrets(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactAuth0ConnectionSecrets(item));
    }
    if (!isRecord(value)) {
        return value;
    }
    const redacted = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        redacted[key] = shouldRedactKey(key)
            ? REDACTED_VALUE
            : redactAuth0ConnectionSecrets(nestedValue);
    }
    return redacted;
}
function mapSamlConnection(input, importedId) {
    const { connection } = input;
    const options = recordValue(connection.options);
    const metadataXml = getFirstString(options, SAML_XML_OPTION_KEYS);
    const parsedMetadata = parseSamlMetadata(metadataXml);
    const idpMetadataUrl = getFirstString(options, SAML_METADATA_URL_KEYS);
    const idpEntityId = firstNonEmpty(getFirstString(options, SAML_IDP_ENTITY_ID_KEYS), parsedMetadata.entityId);
    const idpUrl = firstNonEmpty(getFirstString(options, SAML_IDP_URL_KEYS), parsedMetadata.ssoRedirectUrl);
    const x509Cert = firstNonEmpty(getFirstString(options, SAML_CERT_KEYS), parsedMetadata.x509Cert);
    const missingFields = missingSamlFields({ idpEntityId, idpUrl, x509Cert, idpMetadataUrl });
    if (missingFields.length > 0) {
        const warning = incompleteConnectionConfigurationWarning({
            provider: 'auth0',
            protocol: 'saml',
            importedId,
            strategy: connection.strategy,
            missingFields,
            reason: 'SAML handoff requires IdP metadata URL or the entity ID, SSO URL, and signing certificate.',
        });
        return {
            status: 'skipped',
            protocol: 'saml',
            importedId,
            reason: 'incomplete_connection_configuration',
            warnings: [warning],
        };
    }
    const organization = buildOrganizationContext(connection, input.orgBindings ?? [], 'saml', importedId);
    const attributeMappings = extractAttributeMappings(connection);
    const customAcsUrl = getFirstString(options, SAML_ACS_URL_KEYS);
    const customEntityId = getFirstString(options, SAML_SP_ENTITY_ID_KEYS);
    const sourceAcsUrl = customAcsUrl || buildAuth0CallbackUrl(input.domain, connection.name);
    const samlSecretValues = getSecretValues(options, SAML_SECRET_KEYS);
    const warnings = [...organization.warnings];
    if (!input.includeSecrets && samlSecretValues.length > 0) {
        warnings.push(redactedSecretsWarning({
            provider: 'auth0',
            protocol: 'saml',
            importedId,
            fields: samlSecretValues,
            file: 'sso/saml_connections.csv',
        }));
    }
    const row = createSamlConnectionRow({
        organizationName: organization.organizationName,
        organizationExternalId: organization.organizationExternalId,
        domains: organization.domains.join(','),
        idpEntityId,
        idpUrl,
        x509Cert,
        idpMetadataUrl,
        customEntityId,
        customAcsUrl,
        idpIdAttribute: lookupMapping(attributeMappings, ['user_id', 'sub']),
        emailAttribute: lookupMapping(attributeMappings, ['email']),
        firstNameAttribute: lookupMapping(attributeMappings, ['given_name', 'first_name']),
        lastNameAttribute: lookupMapping(attributeMappings, ['family_name', 'last_name']),
        name: lookupMapping(attributeMappings, ['name']),
        customAttributes: buildCustomAttributesJson(attributeMappings),
        idpInitiatedEnabled: boolishString(getOptionValue(options, ['idpinitiated', 'idpInitiated'])),
        requestSigningKey: input.includeSecrets
            ? getFirstString(options, ['requestSigningKey', 'request_signing_key'])
            : '',
        assertionEncryptionKey: input.includeSecrets
            ? getFirstString(options, ['assertionEncryptionKey', 'assertion_encryption_key'])
            : '',
        nameIdEncryptionKey: input.includeSecrets
            ? getFirstString(options, ['nameIdEncryptionKey', 'name_id_encryption_key'])
            : '',
        importedId,
    });
    return {
        status: 'mapped',
        protocol: 'saml',
        importedId,
        samlRow: row,
        customAttributeRows: toCustomAttributeRows(attributeMappings, importedId, organization, 'SAML'),
        proxyRouteRow: createProxyRouteRow({
            importedId,
            organizationExternalId: organization.organizationExternalId,
            provider: 'auth0',
            protocol: 'saml',
            sourceAcsUrl,
            sourceEntityId: customEntityId,
            customAcsUrl,
            customEntityId,
            cutoverState: 'legacy',
            notes: 'Existing Auth0 SAML ACS route should be proxied until the IdP is updated to WorkOS.',
        }),
        warnings,
    };
}
function mapOidcConnection(input, importedId) {
    const { connection } = input;
    const options = recordValue(connection.options);
    const clientId = getFirstString(options, OIDC_CLIENT_ID_KEYS);
    const clientSecret = getFirstString(options, OIDC_CLIENT_SECRET_KEYS);
    const discoveryEndpoint = normalizeDiscoveryEndpoint(getFirstString(options, OIDC_DISCOVERY_KEYS));
    const missingFields = ['clientId', 'discoveryEndpoint'].filter((field) => {
        if (field === 'clientId')
            return !clientId;
        return !discoveryEndpoint;
    });
    if (input.includeSecrets && !clientSecret) {
        missingFields.push('clientSecret');
    }
    if (missingFields.length > 0) {
        const warning = incompleteConnectionConfigurationWarning({
            provider: 'auth0',
            protocol: 'oidc',
            importedId,
            strategy: connection.strategy,
            missingFields,
            reason: 'OIDC handoff requires a client ID and discovery endpoint.',
        });
        return {
            status: 'skipped',
            protocol: 'oidc',
            importedId,
            reason: 'incomplete_connection_configuration',
            warnings: [warning],
        };
    }
    const organization = buildOrganizationContext(connection, input.orgBindings ?? [], 'oidc', importedId);
    const attributeMappings = extractAttributeMappings(connection);
    const customRedirectUri = getFirstString(options, OIDC_REDIRECT_URI_KEYS);
    const sourceRedirectUri = customRedirectUri || buildAuth0CallbackUrl(input.domain, connection.name);
    const warnings = [...organization.warnings];
    if (!input.includeSecrets && clientSecret) {
        warnings.push(redactedSecretsWarning({
            provider: 'auth0',
            protocol: 'oidc',
            importedId,
            fields: ['clientSecret'],
            file: 'sso/oidc_connections.csv',
        }));
    }
    const row = createOidcConnectionRow({
        organizationName: organization.organizationName,
        organizationExternalId: organization.organizationExternalId,
        domains: organization.domains.join(','),
        clientId,
        clientSecret: input.includeSecrets ? clientSecret : '',
        discoveryEndpoint: discoveryEndpoint ?? '',
        customRedirectUri,
        name: lookupMapping(attributeMappings, ['name']),
        customAttributes: buildCustomAttributesJson(attributeMappings),
        importedId,
    });
    return {
        status: 'mapped',
        protocol: 'oidc',
        importedId,
        oidcRow: row,
        customAttributeRows: toCustomAttributeRows(attributeMappings, importedId, organization, 'OIDC'),
        proxyRouteRow: createProxyRouteRow({
            importedId,
            organizationExternalId: organization.organizationExternalId,
            provider: 'auth0',
            protocol: 'oidc',
            sourceRedirectUri,
            customRedirectUri,
            cutoverState: 'legacy',
            notes: 'Existing Auth0 OIDC redirect route should be proxied until the IdP is updated to WorkOS.',
        }),
        warnings,
    };
}
function missingSamlFields(input) {
    if (input.idpMetadataUrl)
        return [];
    const missing = [];
    if (!input.idpEntityId)
        missing.push('idpEntityId');
    if (!input.idpUrl)
        missing.push('idpUrl');
    if (!input.x509Cert)
        missing.push('x509Cert');
    return missing;
}
function buildOrganizationContext(connection, orgBindings, protocol, importedId) {
    const warnings = [];
    const connectionName = connection.display_name || connection.name;
    if (orgBindings.length === 1) {
        const org = orgBindings[0].organization;
        const domains = extractDomains(org.metadata);
        const context = {
            organizationName: org.display_name || org.name,
            organizationExternalId: org.id,
            domains,
            warnings,
        };
        addMissingDomainWarning(context, protocol, importedId);
        return context;
    }
    if (orgBindings.length > 1) {
        const domains = uniqueDomains(orgBindings.flatMap((binding) => extractDomains(binding.organization.metadata)));
        const organizationExternalId = connection.id;
        const context = {
            organizationName: connectionName,
            organizationExternalId,
            domains,
            warnings,
        };
        warnings.push(multiOrgConnectionConsolidationWarning({
            provider: 'auth0',
            protocol,
            importedId,
            organizationExternalId,
            sourceOrganizationIds: orgBindings.map((binding) => binding.organization.id),
            domains,
        }));
        addMissingDomainWarning(context, protocol, importedId);
        return context;
    }
    const domains = uniqueDomains([
        ...extractDomains(connection.metadata),
        ...extractDomains(recordValue(connection.options)),
    ]);
    const context = {
        organizationName: connectionName,
        organizationExternalId: connection.id,
        domains,
        warnings,
    };
    addMissingDomainWarning(context, protocol, importedId);
    return context;
}
function addMissingDomainWarning(context, protocol, importedId) {
    if (context.domains.length > 0)
        return;
    context.warnings.push(missingDomainsWarning({
        provider: 'auth0',
        protocol,
        importedId,
        organizationExternalId: context.organizationExternalId,
        organizationName: context.organizationName,
    }));
}
function extractAttributeMappings(connection) {
    const options = recordValue(connection.options);
    const mappings = {};
    for (const key of ATTRIBUTE_MAPPING_KEYS) {
        const candidate = getOptionValue(options, [key]) ?? connection[key];
        if (!isRecord(candidate))
            continue;
        for (const [attribute, claim] of Object.entries(candidate)) {
            const stringClaim = stringValue(claim);
            if (!stringClaim)
                continue;
            mappings[attribute] = stringClaim;
        }
    }
    return mappings;
}
function toCustomAttributeRows(attributeMappings, importedId, organization, providerType) {
    return Object.entries(attributeMappings)
        .filter(([attribute, claim]) => Boolean(claim) && !COMMON_PROFILE_ATTRIBUTES.has(attribute))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([attribute, claim]) => createCustomAttributeMappingRow({
        importedId,
        organizationExternalId: organization.organizationExternalId,
        providerType,
        userPoolAttribute: attribute,
        idpClaim: claim,
    }));
}
function buildCustomAttributesJson(attributeMappings) {
    const customMappings = Object.fromEntries(Object.entries(attributeMappings)
        .filter(([attribute, claim]) => Boolean(claim) && !COMMON_PROFILE_ATTRIBUTES.has(attribute))
        .sort(([a], [b]) => a.localeCompare(b)));
    return Object.keys(customMappings).length > 0 ? JSON.stringify(customMappings) : '';
}
function lookupMapping(attributeMappings, keys) {
    for (const key of keys) {
        const value = attributeMappings[key];
        if (value)
            return value;
    }
    return '';
}
function extractDomains(source) {
    if (!isRecord(source))
        return [];
    const values = [
        source.domains,
        source.domain,
        source.domain_aliases,
        source.domainAliases,
        source.email_domains,
        source.emailDomains,
    ];
    return uniqueDomains(values.flatMap((value) => parseDomainValue(value)));
}
function parseDomainValue(value) {
    if (Array.isArray(value)) {
        return value.flatMap((item) => parseDomainValue(item));
    }
    const stringDomain = stringValue(value);
    if (!stringDomain)
        return [];
    return stringDomain
        .split(/[;,\s]+/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);
}
function uniqueDomains(domains) {
    return [...new Set(domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean))].sort();
}
function getSecretValues(options, keys) {
    return keys.filter((key) => Boolean(getFirstString(options, [key])));
}
function getFirstString(record, keys) {
    for (const key of keys) {
        const value = stringValue(getOptionValue(record, [key]));
        if (value)
            return value;
    }
    return '';
}
function getOptionValue(record, keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            return record[key];
        }
    }
    return undefined;
}
function firstNonEmpty(...values) {
    for (const value of values) {
        const normalized = stringValue(value);
        if (normalized)
            return normalized;
    }
    return '';
}
function stringValue(value) {
    if (typeof value !== 'string')
        return '';
    return value.trim();
}
function recordValue(value) {
    return isRecord(value) ? value : {};
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function shouldRedactKey(key) {
    const normalized = key.replace(/[-_\s]/g, '').toLowerCase();
    return (normalized === 'secret' ||
        normalized.endsWith('secret') ||
        normalized === 'password' ||
        normalized.endsWith('password') ||
        normalized.endsWith('privatekey') ||
        normalized === 'requestsigningkey' ||
        normalized === 'assertionencryptionkey' ||
        normalized === 'nameidencryptionkey' ||
        normalized === 'accesstoken' ||
        normalized === 'refreshtoken' ||
        normalized === 'idtoken');
}
function boolishString(value) {
    if (value === undefined || value === null)
        return '';
    if (typeof value === 'boolean')
        return value ? 'TRUE' : 'FALSE';
    return stringValue(value);
}
function buildAuth0CallbackUrl(domain, connectionName) {
    return `https://${domain}/login/callback?connection=${encodeURIComponent(connectionName)}`;
}
