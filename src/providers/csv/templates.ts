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
    headers: ['user_id', 'email', 'email_verified', 'first_name', 'last_name', 'password_hash'],
    required: ['user_id', 'email'],
    optional: ['email_verified', 'first_name', 'last_name', 'password_hash'],
    example: [
      'user_123,john.doe@company.com,true,John,Doe,$2a$10$abcd...',
      'user_456,jane.smith@company.com,false,Jane,Smith,$2a$10$efgh...',
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

  connections_saml: {
    name: 'SAML Connections',
    description: 'SAML SSO connections (WorkOS standalone SSO import)',
    filename: 'workos_saml_connections.csv',
    headers: [
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
    ],
    // At least one of idpMetadataUrl OR (idpUrl + x509Cert) is required per the
    // WorkOS SAML import contract; organization identity is satisfied by any of
    // the four combos in README (organizationName alone is enough). See
    // shared/csv.ts for the canonical schema.
    required: ['organizationName'],
    optional: [
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
    ],
    example: [
      'Acme Corporation,,acme-saml,"acme.com;app.acme.com",https://acme.okta.com/entity,https://acme.okta.com/sso,MIICXjCC...,,,,,email,firstName,lastName,,,,,,,acme-saml',
    ],
    validation: {
      organizationName: (value: string) => value.length > 0 || 'Organization name cannot be empty',
      domains: (value: string) => {
        if (!value) return true;
        const domains = value.split(';');
        const domainRegex =
          /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[a-zA-Z]{2,}\.[a-zA-Z]{2,})$/;
        const invalid = domains.filter((d) => d.trim() && !domainRegex.test(d.trim()));
        return invalid.length === 0 || `Invalid domain format: ${invalid.join(', ')}`;
      },
      idpUrl: httpsUrlCheck,
      idpMetadataUrl: httpsUrlCheck,
      customAcsUrl: httpsUrlCheck,
      idpInitiatedEnabled: (value: string) => {
        if (!value) return true;
        return ['true', 'false', 'TRUE', 'FALSE'].includes(value) || 'Must be true or false';
      },
      customAttributes: (value: string) => {
        if (!value) return true;
        try {
          const parsed = JSON.parse(value);
          return (
            (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ||
            'customAttributes must be a JSON object'
          );
        } catch {
          return 'customAttributes must be valid JSON';
        }
      },
    },
  },

  connections_oidc: {
    name: 'OIDC Connections',
    description: 'OIDC SSO connections (WorkOS standalone SSO import)',
    filename: 'workos_oidc_connections.csv',
    headers: [
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
    ],
    required: ['organizationName', 'clientId', 'clientSecret', 'discoveryEndpoint'],
    optional: [
      'organizationId',
      'organizationExternalId',
      'domains',
      'customRedirectUri',
      'name',
      'customAttributes',
      'importedId',
    ],
    example: [
      'Acme Corporation,,acme-oidc,acme.com,oidc-client-id,oidc-client-secret,https://idp.acme.com/.well-known/openid-configuration,,,,acme-oidc',
    ],
    validation: {
      organizationName: (value: string) => value.length > 0 || 'Organization name cannot be empty',
      clientId: (value: string) => value.length > 0 || 'clientId is required',
      clientSecret: (value: string) => value.length > 0 || 'clientSecret is required',
      discoveryEndpoint: (value: string) => {
        if (!value) return 'discoveryEndpoint is required';
        try {
          const url = new URL(value);
          return url.protocol === 'https:' || 'discoveryEndpoint must use HTTPS';
        } catch {
          return 'Invalid URL format';
        }
      },
      customRedirectUri: httpsUrlCheck,
      customAttributes: (value: string) => {
        if (!value) return true;
        try {
          const parsed = JSON.parse(value);
          return (
            (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ||
            'customAttributes must be a JSON object'
          );
        } catch {
          return 'customAttributes must be valid JSON';
        }
      },
    },
  },
};

function httpsUrlCheck(value: string): boolean | string {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return 'Invalid URL format';
  }
}

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
