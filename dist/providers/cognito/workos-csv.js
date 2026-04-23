"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE = exports.rowsToCsv = exports.CUSTOM_ATTR_HEADERS = exports.USER_HEADERS = exports.OIDC_HEADERS = exports.SAML_HEADERS = void 0;
exports.isSaml = isSaml;
exports.isOidc = isOidc;
exports.importedId = importedId;
exports.renderTemplate = renderTemplate;
exports.buildCustomAttributesJson = buildCustomAttributesJson;
exports.toUserRow = toUserRow;
exports.toSamlRow = toSamlRow;
exports.toOidcRow = toOidcRow;
exports.toCustomAttrRows = toCustomAttrRows;
/**
 * Cognito-specific row builders that produce rows matching the shared WorkOS
 * import templates (see src/shared/csv.ts).
 */
const saml_metadata_1 = require("./saml-metadata");
const names_1 = require("../../shared/names");
const csv_1 = require("../../shared/csv");
Object.defineProperty(exports, "SAML_HEADERS", { enumerable: true, get: function () { return csv_1.SAML_HEADERS; } });
Object.defineProperty(exports, "OIDC_HEADERS", { enumerable: true, get: function () { return csv_1.OIDC_HEADERS; } });
Object.defineProperty(exports, "USER_HEADERS", { enumerable: true, get: function () { return csv_1.USER_HEADERS; } });
Object.defineProperty(exports, "CUSTOM_ATTR_HEADERS", { enumerable: true, get: function () { return csv_1.CUSTOM_ATTR_HEADERS; } });
Object.defineProperty(exports, "rowsToCsv", { enumerable: true, get: function () { return csv_1.rowsToCsv; } });
// ---------------------------------------------------------------------------
// Cognito attribute-mapping keys (shape of `AttributeMapping` dict)
// ---------------------------------------------------------------------------
const UP_EMAIL = 'email';
const UP_GIVEN_NAME = 'given_name';
const UP_FAMILY_NAME = 'family_name';
const UP_NAME = 'name';
/** Everything in this set lands in the supplementary debug CSV. */
const SUPPLEMENTARY_ATTR_KEYS = new Set([
    UP_NAME,
    'custom:department',
    'custom:location',
    'custom:title',
    'custom:user_status',
    'custom:user_type',
]);
/** Default matches the Cognito SP entity ID that customer IdPs already have configured. */
exports.DEFAULT_SAML_CUSTOM_ENTITY_ID_TEMPLATE = 'urn:amazon:cognito:sp:{user_pool_id}';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isSaml(p) {
    return p.providerType.toUpperCase() === 'SAML';
}
function isOidc(p) {
    return p.providerType.toUpperCase() === 'OIDC';
}
function importedId(p) {
    return `${p.userPoolId}:${p.providerName}`;
}
function renderTemplate(template, p) {
    if (!template)
        return '';
    return template
        .replace(/\{provider_name\}/g, p.providerName)
        .replace(/\{user_pool_id\}/g, p.userPoolId)
        .replace(/\{region\}/g, p.region);
}
/** 'custom:<name>' attribute mappings → compact JSON with the 'custom:' prefix stripped. */
function buildCustomAttributesJson(attrs) {
    const entries = Object.entries(attrs)
        .filter(([k, v]) => k.startsWith('custom:') && v)
        .map(([k, v]) => [k.substring('custom:'.length), v])
        .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0)
        return '';
    return JSON.stringify(Object.fromEntries(entries));
}
// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------
function toUserRow(u) {
    const a = u.attributes;
    const { first, last } = (0, names_1.splitName)(a.name ?? '');
    return {
        user_id: a.sub ?? u.username,
        email: a.email ?? '',
        email_verified: a.email_verified ?? '',
        first_name: a.given_name ?? first,
        last_name: a.family_name ?? last,
        password_hash: '',
    };
}
function toSamlRow(p, proxy = {}) {
    const details = p.providerDetails;
    const attrs = p.attributeMapping;
    const metadataUrl = details.MetadataURL ?? '';
    const metadataXml = details.MetadataFile ?? '';
    const parsed = metadataXml ? (0, saml_metadata_1.parseSamlMetadata)(metadataXml) : null;
    return {
        organizationName: p.providerName,
        organizationId: '',
        organizationExternalId: p.providerName,
        domains: '',
        idpEntityId: parsed?.entityId ?? details.EntityId ?? '',
        idpUrl: parsed?.ssoRedirectUrl ?? details.SSORedirectBindingURI ?? '',
        x509Cert: parsed?.x509Cert ?? '',
        idpMetadataUrl: metadataUrl,
        customEntityId: renderTemplate(proxy.samlCustomEntityId ?? null, p),
        customAcsUrl: renderTemplate(proxy.samlCustomAcsUrl ?? null, p),
        idpIdAttribute: '',
        emailAttribute: attrs[UP_EMAIL] ?? '',
        firstNameAttribute: attrs[UP_GIVEN_NAME] ?? '',
        lastNameAttribute: attrs[UP_FAMILY_NAME] ?? '',
        name: attrs[UP_NAME] ?? '',
        customAttributes: buildCustomAttributesJson(attrs),
        idpInitiatedEnabled: 'TRUE',
        requestSigningKey: '',
        assertionEncryptionKey: '',
        nameIdEncryptionKey: '',
        importedId: importedId(p),
    };
}
function toOidcRow(p, proxy = {}) {
    const details = p.providerDetails;
    const attrs = p.attributeMapping;
    return {
        organizationName: p.providerName,
        organizationId: '',
        organizationExternalId: p.providerName,
        domains: '',
        clientId: details.client_id ?? '',
        clientSecret: details.client_secret ?? '',
        discoveryEndpoint: (0, saml_metadata_1.normalizeDiscoveryEndpoint)(details.oidc_issuer) ?? '',
        customRedirectUri: renderTemplate(proxy.oidcCustomRedirectUri ?? null, p),
        name: attrs[UP_NAME] ?? '',
        customAttributes: buildCustomAttributesJson(attrs),
        importedId: importedId(p),
    };
}
function toCustomAttrRows(p) {
    const rows = [];
    for (const [attr, claim] of Object.entries(p.attributeMapping)) {
        if (!SUPPLEMENTARY_ATTR_KEYS.has(attr))
            continue;
        rows.push({
            importedId: importedId(p),
            organizationExternalId: p.providerName,
            providerType: p.providerType,
            userPoolAttribute: attr,
            idpClaim: claim,
        });
    }
    return rows;
}
