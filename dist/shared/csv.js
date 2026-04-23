"use strict";
/**
 * Shared CSV helpers + column schemas for WorkOS import CSVs.
 *
 * Schemas match the official WorkOS import templates, with the new `name` and
 * `customAttributes` columns that WorkOS is adding as standard fields.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_ATTR_HEADERS = exports.USER_HEADERS = exports.OIDC_HEADERS = exports.SAML_HEADERS = void 0;
exports.escapeCSVField = escapeCSVField;
exports.createCSVRow = createCSVRow;
exports.createCSV = createCSV;
exports.rowsToCsv = rowsToCsv;
/** SAML connections import template. */
exports.SAML_HEADERS = [
    'organizationName',
    'organizationId',
    'organizationExternalId',
    'domains',
    'idpEntityId',
    'idpUrl',
    'x509Cert',
    'idpMetadataUrl',
    'customEntityId',
    'customAcsUrl',
    'idpIdAttribute',
    'emailAttribute',
    'firstNameAttribute',
    'lastNameAttribute',
    'name',
    'customAttributes',
    'idpInitiatedEnabled',
    'requestSigningKey',
    'assertionEncryptionKey',
    'nameIdEncryptionKey',
    'importedId',
];
/** OIDC connections import template. */
exports.OIDC_HEADERS = [
    'organizationName',
    'organizationId',
    'organizationExternalId',
    'domains',
    'clientId',
    'clientSecret',
    'discoveryEndpoint',
    'customRedirectUri',
    'name',
    'customAttributes',
    'importedId',
];
/** Users import template. */
exports.USER_HEADERS = [
    'user_id',
    'email',
    'email_verified',
    'first_name',
    'last_name',
    'password_hash',
];
/** Supplementary debug view: per-attribute mappings not covered by the main columns. */
exports.CUSTOM_ATTR_HEADERS = [
    'importedId',
    'organizationExternalId',
    'providerType',
    'userPoolAttribute',
    'idpClaim',
];
// ---------------------------------------------------------------------------
// CSV primitives
// ---------------------------------------------------------------------------
function escapeCSVField(field) {
    const value = String(field ?? '');
    if (/[",\n\r]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}
function createCSVRow(fields) {
    return fields.map(escapeCSVField).join(',');
}
function createCSV(header, rows) {
    return [header.join(','), ...rows].join('\n') + '\n';
}
/** Render a list of records keyed by header name into a CSV string. */
function rowsToCsv(headers, rows) {
    const escape = (value) => escapeCSVField(value);
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push(headers.map((h) => escape(row[h])).join(','));
    }
    return lines.join('\n') + '\n';
}
