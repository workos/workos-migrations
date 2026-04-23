"use strict";
/**
 * Shared CSV helpers + column schemas for WorkOS import CSVs.
 *
 * Canonical SAML / OIDC / common header sets used by all provider transforms.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OIDC_HEADERS = exports.SAML_HEADERS = exports.COMMON_HEADERS = void 0;
exports.escapeCSVField = escapeCSVField;
exports.createCSVRow = createCSVRow;
exports.createCSV = createCSV;
exports.createCSVFromRecords = createCSVFromRecords;
exports.COMMON_HEADERS = [
    'organizationName',
    'organizationId',
    'organizationExternalId',
    'domains',
    'importedId',
    'connectionBookmarks',
];
exports.SAML_HEADERS = [
    ...exports.COMMON_HEADERS,
    'idpEntityId',
    'idpUrl',
    'x509Cert',
    'idpIdAttribute',
    'emailAttribute',
    'firstNameAttribute',
    'lastNameAttribute',
    'name',
    'customAttributes',
    'idpMetadataUrl',
    'customEntityId',
    'customAcsUrl',
    'idpInitiatedSsoEnabled',
    'defaultConnectionBookmarkForIdpInitiatedSso',
];
exports.OIDC_HEADERS = [
    ...exports.COMMON_HEADERS,
    'clientId',
    'clientSecret',
    'discoveryEndpoint',
    'customRedirectUri',
    'name',
    'customAttributes',
];
function escapeCSVField(field) {
    const value = String(field ?? '');
    return `"${value.replace(/"/g, '""')}"`;
}
function createCSVRow(fields) {
    return fields.map(escapeCSVField).join(',');
}
function createCSV(header, rows) {
    return [header.join(','), ...rows].join('\n');
}
/** Build a CSV from rows keyed by header name; fields missing from a row become empty strings. */
function createCSVFromRecords(header, records) {
    const rowStrings = records.map((record) => createCSVRow(header.map((h) => record[h] ?? '')));
    return createCSV(header, rowStrings);
}
//# sourceMappingURL=csv.js.map