export interface CSVTemplate {
  name: string;
  description: string;
  filename: string;
  headers: string[];
  required: string[];
  optional: string[];
  example: string[];
  validation?: {
    [column: string]: (value: string) => boolean | string;
  };
}

export const CSV_TEMPLATES: Record<string, CSVTemplate> = {
  users: {
    name: 'Users',
    description: 'User accounts with authentication details',
    filename: 'users.csv',
    headers: [
      'user_id',
      'email',
      'email_verified',
      'first_name',
      'last_name',
      'name',
      'password_hash',
    ],
    required: ['user_id', 'email'],
    optional: ['email_verified', 'first_name', 'last_name', 'name', 'password_hash'],
    example: [
      'user_123,john.doe@company.com,true,John,Doe,John Doe,$2a$10$abcd...',
      'user_456,jane.smith@company.com,false,Jane,Smith,Jane Smith,$2a$10$efgh...',
    ],
    validation: {
      email: (value: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value) || 'Invalid email format';
      },
      email_verified: (value: string) => {
        if (!value) return true; // Optional field
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
      name: (value: string) => {
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

  saml_connections: {
    name: 'SAML Connections',
    description: 'SAML SSO connections',
    filename: 'saml_connections.csv',
    headers: [
      'name',
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
      'nameAttribute',
      'idpInitiatedEnabled',
      'requestSigningKey',
      'assertionEncryptionKey',
      'nameIdEncryptionKey',
      'importedId',
    ],
    required: ['organizationName', 'organizationId'],
    optional: [
      'name',
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
      'nameAttribute',
      'idpInitiatedEnabled',
      'requestSigningKey',
      'assertionEncryptionKey',
      'nameIdEncryptionKey',
      'importedId',
    ],
    example: [
      'Acme SAML,Acme Corporation,org_123,,acme.com;app.acme.com,https://acme.okta.com,https://acme.okta.com/app/saml,MIICXjCCAcegAwIBAgIBADANBgkqhkiG9w0BAQ0FADCBhzELMAkGA1UEBhMCVVMx...,https://acme.okta.com/app/metadata,,https://acme.com/saml/acs,email,,,,,,,,',
      'Example SAML,Example Industries,org_456,,example.com,https://example.auth0.com/,https://example.auth0.com/saml,,https://example.auth0.com/samlp/metadata,,,uid,,,,,,,',
    ],
    validation: {
      organizationName: (value: string) => {
        return value.length > 0 || 'Organization name cannot be empty';
      },
      organizationId: (value: string) => {
        return value.length > 0 || 'Organization ID cannot be empty';
      },
      domains: (value: string) => {
        if (!value) return true;
        const domains = value.split(';');
        const domainRegex =
          /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
        const invalidDomains = domains.filter(
          (domain) => domain.trim() && !domainRegex.test(domain.trim()),
        );
        return invalidDomains.length === 0 || `Invalid domain format: ${invalidDomains.join(', ')}`;
      },
      idpUrl: (value: string) => {
        if (!value) return true;
        try {
          new URL(value);
          return true;
        } catch {
          return 'Invalid URL format';
        }
      },
      idpMetadataUrl: (value: string) => {
        if (!value) return true;
        try {
          new URL(value);
          return true;
        } catch {
          return 'Invalid URL format';
        }
      },
      customAcsUrl: (value: string) => {
        if (!value) return true;
        try {
          new URL(value);
          return true;
        } catch {
          return 'Invalid URL format';
        }
      },
    },
  },

  oidc_connections: {
    name: 'OIDC Connections',
    description: 'OIDC SSO connections',
    filename: 'oidc_connections.csv',
    headers: [
      'name',
      'organizationName',
      'organizationId',
      'organizationExternalId',
      'domains',
      'clientId',
      'clientSecret',
      'discoveryEndpoint',
      'customRedirectUri',
      'importedId',
    ],
    required: ['organizationName', 'organizationId'],
    optional: [
      'name',
      'organizationExternalId',
      'domains',
      'clientId',
      'clientSecret',
      'discoveryEndpoint',
      'customRedirectUri',
      'importedId',
    ],
    example: [
      'Acme OIDC,Acme Corporation,org_123,,acme.com,client_abc123,secret_xyz789,https://accounts.google.com/.well-known/openid-configuration,,',
      'Example OIDC,Example Industries,org_456,,example.com,client_def456,secret_uvw321,https://login.microsoftonline.com/tenant-id/v2.0/.well-known/openid-configuration,,',
    ],
    validation: {
      organizationName: (value: string) => {
        return value.length > 0 || 'Organization name cannot be empty';
      },
      organizationId: (value: string) => {
        return value.length > 0 || 'Organization ID cannot be empty';
      },
      domains: (value: string) => {
        if (!value) return true;
        const domains = value.split(';');
        const domainRegex =
          /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
        const invalidDomains = domains.filter(
          (domain) => domain.trim() && !domainRegex.test(domain.trim()),
        );
        return invalidDomains.length === 0 || `Invalid domain format: ${invalidDomains.join(', ')}`;
      },
      discoveryEndpoint: (value: string) => {
        if (!value) return true;
        try {
          new URL(value);
          return true;
        } catch {
          return 'Invalid URL format';
        }
      },
      customRedirectUri: (value: string) => {
        if (!value) return true;
        try {
          new URL(value);
          return true;
        } catch {
          return 'Invalid URL format';
        }
      },
    },
  },
};

export function getTemplate(templateName: string): CSVTemplate | undefined {
  return CSV_TEMPLATES[templateName];
}

export function getAllTemplates(): CSVTemplate[] {
  return Object.values(CSV_TEMPLATES);
}

export function generateTemplateExample(templateName: string): string {
  const template = getTemplate(templateName);
  if (!template) {
    throw new Error(`Template ${templateName} not found`);
  }

  const header = template.headers.join(',');
  const examples = template.example.join('\n');

  return `${header}\n${examples}`;
}

export function validateCSVHeaders(
  templateName: string,
  headers: string[],
): { valid: boolean; errors: string[] } {
  const template = getTemplate(templateName);
  if (!template) {
    return { valid: false, errors: [`Template ${templateName} not found`] };
  }

  const errors: string[] = [];

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
