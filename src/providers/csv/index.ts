import type { Provider } from '../../shared/types.js';

export const csvProvider: Provider = {
  name: 'csv',
  displayName: 'CSV Import to WorkOS',
  credentials: [
    {
      key: 'workosApiKey',
      name: 'WorkOS API Key',
      type: 'password',
      required: true,
      envVar: 'WORKOS_API_KEY',
    },
  ],
  entities: [
    {
      key: 'users',
      name: 'Users',
      description: 'User accounts with authentication details',
      enabled: true,
    },
    {
      key: 'organizations',
      name: 'Organizations',
      description: 'Organization entities',
      enabled: true,
    },
    {
      key: 'organization_memberships',
      name: 'Organization Memberships',
      description: 'User memberships in organizations',
      enabled: true,
    },
    {
      key: 'connections',
      name: 'Connections',
      description: 'Authentication connections (SSO configurations)',
      enabled: true,
    },
  ],
};

export {
  getAllTemplates,
  getTemplate,
  generateTemplateExample,
  validateCSVHeaders,
} from './templates.js';
