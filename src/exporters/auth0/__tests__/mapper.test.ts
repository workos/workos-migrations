import {
  mapAuth0UserToWorkOS,
  validateMappedRow,
  extractOrgFromMetadata,
} from '../mapper.js';
import type { Auth0User, Auth0Organization } from '../../../shared/types.js';

describe('Auth0 Mapper', () => {
  const testUser: Auth0User = {
    user_id: 'auth0|123456',
    email: 'test@example.com',
    email_verified: true,
    given_name: 'Test',
    family_name: 'User',
    name: 'Test User',
    user_metadata: { department: 'Engineering' },
    app_metadata: { role: 'Developer' },
    created_at: '2024-01-15T10:30:00.000Z',
    updated_at: '2024-12-01T14:22:33.000Z',
  };

  const testOrg: Auth0Organization = {
    id: 'org_abc123',
    name: 'Acme Corporation',
    display_name: 'Acme Corp',
  };

  describe('mapAuth0UserToWorkOS', () => {
    it('should map basic fields correctly', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg);

      expect(row.email).toBe('test@example.com');
      expect(row.first_name).toBe('Test');
      expect(row.last_name).toBe('User');
      expect(row.email_verified).toBe(true);
      expect(row.external_id).toBe('auth0|123456');
      expect(row.org_external_id).toBe('org_abc123');
      expect(row.org_name).toBe('Acme Corp');
    });

    it('should merge user_metadata and app_metadata', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg);
      const metadata = JSON.parse(row.metadata as string);

      expect(metadata.department).toBe('Engineering');
      expect(metadata.role).toBe('Developer');
      expect(metadata.auth0_user_id).toBe('auth0|123456');
    });

    it('should parse name from full name when given/family not available', () => {
      const user: Auth0User = {
        ...testUser,
        given_name: undefined,
        family_name: undefined,
        name: 'John Doe',
      };

      const row = mapAuth0UserToWorkOS(user, testOrg);
      expect(row.first_name).toBe('John');
      expect(row.last_name).toBe('Doe');
    });

    it('should fallback org_name to name when display_name missing', () => {
      const org: Auth0Organization = { id: 'org_xyz', name: 'Fallback Org' };
      const row = mapAuth0UserToWorkOS(testUser, org);
      expect(row.org_name).toBe('Fallback Org');
    });

    it('should map password hash with algorithm detection', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg, {
        hash: '$2a$10$someHashValue',
        algorithm: 'bcrypt',
      });

      expect(row.password_hash).toBe('$2a$10$someHashValue');
      expect(row.password_hash_type).toBe('bcrypt');
    });

    it('should prefix reserved metadata fields with auth0_', () => {
      const user: Auth0User = {
        ...testUser,
        user_metadata: { org_id: 'conflict_value', normal_field: 'ok' },
      };

      const row = mapAuth0UserToWorkOS(user, testOrg);
      const metadata = JSON.parse(row.metadata as string);

      expect(metadata.auth0_org_id).toBe('conflict_value');
      expect(metadata.normal_field).toBe('ok');
    });
  });

  describe('validateMappedRow', () => {
    it('should return null for valid rows', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg);
      expect(validateMappedRow(row)).toBeNull();
    });

    it('should reject missing email', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg);
      row.email = undefined;
      expect(validateMappedRow(row)).toContain('email');
    });

    it('should reject invalid email format', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg);
      row.email = 'not-an-email';
      expect(validateMappedRow(row)).toContain('email');
    });

    it('should reject invalid metadata JSON', () => {
      const row = mapAuth0UserToWorkOS(testUser, testOrg);
      row.metadata = '{invalid json';
      expect(validateMappedRow(row)).toContain('metadata');
    });
  });

  describe('extractOrgFromMetadata', () => {
    it('should extract org from user_metadata', () => {
      const user: Auth0User = {
        ...testUser,
        user_metadata: {
          organization_id: 'org_from_metadata',
          organization_name: 'Metadata Org',
        },
      };

      const result = extractOrgFromMetadata(user);
      expect(result).toEqual({
        orgId: 'org_from_metadata',
        orgName: 'Metadata Org',
      });
    });

    it('should extract org from app_metadata as fallback', () => {
      const user: Auth0User = {
        ...testUser,
        user_metadata: {},
        app_metadata: { org_id: 'org_from_app', org_name: 'App Org' },
      };

      const result = extractOrgFromMetadata(user);
      expect(result).toEqual({ orgId: 'org_from_app', orgName: 'App Org' });
    });

    it('should return null when no org in metadata', () => {
      const user: Auth0User = {
        ...testUser,
        user_metadata: { some_field: 'value' },
        app_metadata: {},
      };

      expect(extractOrgFromMetadata(user)).toBeNull();
    });

    it('should support custom field names', () => {
      const user: Auth0User = {
        ...testUser,
        user_metadata: { company_id: 'company_123', company_name: 'Custom Co' },
      };

      const result = extractOrgFromMetadata(user, 'company_id', 'company_name');
      expect(result).toEqual({ orgId: 'company_123', orgName: 'Custom Co' });
    });

    it('should mix custom and default fields', () => {
      const user: Auth0User = {
        ...testUser,
        user_metadata: {
          organization_id: 'org_default',
          company_name: 'Mixed Company',
        },
      };

      const result = extractOrgFromMetadata(user, 'company_id', 'company_name');
      expect(result).toEqual({ orgId: 'org_default', orgName: 'Mixed Company' });
    });
  });
});
