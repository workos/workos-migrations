import { Provider } from '../../types';

export const clerkProvider: Provider = {
  name: 'clerk',
  displayName: 'Clerk',
  credentials: [
    {
      key: 'secretKey',
      name: 'Secret Key',
      type: 'password',
      required: true,
      envVar: 'CLERK_SECRET_KEY',
    },
  ],
  entities: [
    {
      key: 'users',
      name: 'Users',
      description: 'User accounts and profiles',
      enabled: false,
    },
    {
      key: 'organizations',
      name: 'Organizations',
      description: 'Organizations and their members',
      enabled: false,
    },
  ],
};
