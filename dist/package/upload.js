import { UPLOAD_ORGANIZATION_CSV_HEADERS, UPLOAD_ORGANIZATION_MEMBERSHIP_CSV_HEADERS, UPLOAD_USER_CSV_HEADERS, } from './manifest.js';
export function createUploadUserRow(input = {}) {
    return createRow(UPLOAD_USER_CSV_HEADERS, input);
}
export function createUploadOrganizationRow(input = {}) {
    return createRow(UPLOAD_ORGANIZATION_CSV_HEADERS, input);
}
export function createUploadOrganizationMembershipRow(input = {}) {
    return createRow(UPLOAD_ORGANIZATION_MEMBERSHIP_CSV_HEADERS, input);
}
export function packageUserToUploadUserRow(input) {
    const userId = stringValue(input.external_id);
    const email = stringValue(input.email);
    if (!userId || !email)
        return undefined;
    return createUploadUserRow({
        user_id: userId,
        email,
        email_verified: stringValue(input.email_verified),
        first_name: stringValue(input.first_name),
        last_name: stringValue(input.last_name),
        password_hash: stringValue(input.password_hash),
    });
}
export function packageOrganizationToUploadOrganizationRow(input) {
    const organizationId = stringValue(input.org_external_id || input.org_id);
    const name = stringValue(input.org_name || input.org_external_id || input.org_id);
    if (!organizationId)
        return undefined;
    return createUploadOrganizationRow({
        organization_id: organizationId,
        name,
    });
}
export function packageMembershipToUploadMembershipRow(input) {
    const organizationId = stringValue(input.org_external_id || input.org_id);
    const userId = stringValue(input.external_id || input.user_id);
    if (!organizationId || !userId)
        return undefined;
    return createUploadOrganizationMembershipRow({
        organization_id: organizationId,
        user_id: userId,
    });
}
function createRow(headers, input) {
    const row = {};
    for (const header of headers) {
        row[header] = stringValue(input[header]);
    }
    return row;
}
function stringValue(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    return String(value);
}
