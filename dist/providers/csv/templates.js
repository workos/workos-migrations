"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CSV_TEMPLATES = void 0;
exports.getTemplate = getTemplate;
exports.getAllTemplates = getAllTemplates;
exports.generateTemplateExample = generateTemplateExample;
exports.validateCSVHeaders = validateCSVHeaders;
exports.CSV_TEMPLATES = {
    users: {
        name: 'Users',
        description: 'User accounts with authentication details',
        filename: 'users.csv',
        headers: ['user_id', 'email', 'email_verified', 'first_name', 'last_name', 'password_hash'],
        required: ['user_id', 'email'],
        optional: ['email_verified', 'first_name', 'last_name', 'password_hash'],
        example: [
            'user_123,john.doe@company.com,true,John,Doe,$2a$10$abcd...',
            'user_456,jane.smith@company.com,false,Jane,Smith,$2a$10$efgh...',
        ],
        validation: {
            email: (value) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(value) || 'Invalid email format';
            },
            email_verified: (value) => {
                if (!value)
                    return true; // Optional field
                return ['true', 'false'].includes(value.toLowerCase()) || 'Must be true or false';
            },
        },
    },
    organizations: {
        name: 'Organizations',
        description: 'Organization entities',
        filename: 'organizations.csv',
        headers: ['organization_id', 'name'],
        required: ['organization_id', 'name'],
        optional: [],
        example: ['org_123,Acme Corporation', 'org_456,Example Industries'],
        validation: {
            name: (value) => {
                return value.length > 0 || 'Organization name cannot be empty';
            },
        },
    },
    organization_memberships: {
        name: 'Organization Memberships',
        description: 'User memberships in organizations',
        filename: 'organization_memberships.csv',
        headers: ['organization_id', 'user_id'],
        required: ['organization_id', 'user_id'],
        optional: [],
        example: ['org_123,user_123', 'org_123,user_456', 'org_456,user_456'],
    },
    connections: {
        name: 'Connections',
        description: 'Authentication connections (SSO configurations)',
        filename: 'connections.csv',
        headers: [
            'organizationName',
            'organizationId',
            'domains',
            'idpEntityId',
            'idpUrl',
            'x509Cert',
            'idpIdAttribute',
            'idpMetadataUrl',
            'customEntityId',
            'customAcsUrl',
            'requestSigningCert',
        ],
        required: ['organizationName', 'organizationId'],
        optional: [
            'domains',
            'idpEntityId',
            'idpUrl',
            'x509Cert',
            'idpIdAttribute',
            'idpMetadataUrl',
            'customEntityId',
            'customAcsUrl',
            'requestSigningCert',
        ],
        example: [
            'Acme Corporation,org_123,acme.com;app.acme.com,https://acme.okta.com,https://acme.okta.com/app/saml,MIICXjCCAcegAwIBAgIBADANBgkqhkiG9w0BAQ0FADCBhzELMAkGA1UEBhMCVVMx...,email,https://acme.okta.com/app/metadata,,https://acme.com/saml/acs,',
            'Example Industries,org_456,example.com,https://example.auth0.com/,https://example.auth0.com/saml,,uid,https://example.auth0.com/samlp/metadata,,,',
        ],
        validation: {
            organizationName: (value) => {
                return value.length > 0 || 'Organization name cannot be empty';
            },
            organizationId: (value) => {
                return value.length > 0 || 'Organization ID cannot be empty';
            },
            domains: (value) => {
                if (!value)
                    return true; // Optional field
                // Check if domains are separated by semicolons and are valid domain format
                const domains = value.split(';');
                const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
                const invalidDomains = domains.filter((domain) => domain.trim() && !domainRegex.test(domain.trim()));
                return invalidDomains.length === 0 || `Invalid domain format: ${invalidDomains.join(', ')}`;
            },
            idpUrl: (value) => {
                if (!value)
                    return true; // Optional field
                try {
                    new URL(value);
                    return true;
                }
                catch {
                    return 'Invalid URL format';
                }
            },
            idpMetadataUrl: (value) => {
                if (!value)
                    return true; // Optional field
                try {
                    new URL(value);
                    return true;
                }
                catch {
                    return 'Invalid URL format';
                }
            },
            customAcsUrl: (value) => {
                if (!value)
                    return true; // Optional field
                try {
                    new URL(value);
                    return true;
                }
                catch {
                    return 'Invalid URL format';
                }
            },
        },
    },
};
function getTemplate(templateName) {
    return exports.CSV_TEMPLATES[templateName];
}
function getAllTemplates() {
    return Object.values(exports.CSV_TEMPLATES);
}
function generateTemplateExample(templateName) {
    const template = getTemplate(templateName);
    if (!template) {
        throw new Error(`Template ${templateName} not found`);
    }
    const header = template.headers.join(',');
    const examples = template.example.join('\n');
    return `${header}\n${examples}`;
}
function validateCSVHeaders(templateName, headers) {
    const template = getTemplate(templateName);
    if (!template) {
        return { valid: false, errors: [`Template ${templateName} not found`] };
    }
    const errors = [];
    // Check if all required headers are present
    const missingRequired = template.required.filter((required) => !headers.includes(required));
    if (missingRequired.length > 0) {
        errors.push(`Missing required columns: ${missingRequired.join(', ')}`);
    }
    // Check if there are any unexpected headers
    const expectedHeaders = [...template.required, ...template.optional];
    const unexpectedHeaders = headers.filter((header) => !expectedHeaders.includes(header));
    if (unexpectedHeaders.length > 0) {
        errors.push(`Unexpected columns: ${unexpectedHeaders.join(', ')}`);
    }
    return { valid: errors.length === 0, errors };
}
