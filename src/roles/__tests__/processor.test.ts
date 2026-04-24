import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { jest } from '@jest/globals';

// Mock API client with jest.unstable_mockModule for ESM
const mockCreateEnvRole = jest.fn<any>();
const mockCreateOrgRole = jest.fn<any>();
const mockCreatePermission = jest.fn<any>();
const mockAssignPerms = jest.fn<any>();
const mockListRoles = jest.fn<any>();

jest.unstable_mockModule('../api-client.js', () => ({
  createEnvironmentRole: mockCreateEnvRole,
  createOrganizationRole: mockCreateOrgRole,
  createPermission: mockCreatePermission,
  assignPermissionsToRole: mockAssignPerms,
  listRolesForOrganization: mockListRoles,
}));

// Mock logger to avoid chalk ESM issues
jest.unstable_mockModule('../../shared/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
}));

// Dynamic import after mocks are set up
const { parsePermissions, parseRoleDefinitionsCsv, processRoleDefinitions, assignRolesToUsers } =
  await import('../processor.js');

describe('Role Processor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-test-'));
    jest.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parsePermissions', () => {
    it('should parse comma-separated permissions', () => {
      expect(parsePermissions('read,write,delete')).toEqual(['read', 'write', 'delete']);
    });

    it('should parse JSON array permissions', () => {
      expect(parsePermissions('["read","write"]')).toEqual(['read', 'write']);
    });

    it('should handle empty string', () => {
      expect(parsePermissions('')).toEqual([]);
    });

    it('should trim whitespace', () => {
      expect(parsePermissions(' read , write ')).toEqual(['read', 'write']);
    });
  });

  describe('parseRoleDefinitionsCsv', () => {
    it('should parse valid role definitions', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        [
          'role_slug,role_name,role_type,permissions',
          'admin,Admin,environment,"read,write,delete"',
          'viewer,Viewer,environment,read',
        ].join('\n'),
      );

      const { definitions, errors } = await parseRoleDefinitionsCsv(csvPath);

      expect(definitions).toHaveLength(2);
      expect(definitions[0]!.slug).toBe('admin');
      expect(definitions[0]!.permissions).toEqual(['read', 'write', 'delete']);
      expect(definitions[1]!.slug).toBe('viewer');
      expect(errors).toHaveLength(0);
    });

    it('should error on missing required columns', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(csvPath, ['role_slug,role_name', 'admin,Admin'].join('\n'));

      await expect(parseRoleDefinitionsCsv(csvPath)).rejects.toThrow('missing required columns');
    });

    it('should warn on invalid role_type', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', 'admin,Admin,invalid,read'].join('\n'),
      );

      const { definitions, warnings } = await parseRoleDefinitionsCsv(csvPath);

      expect(definitions).toHaveLength(0);
      expect(warnings.some((w) => w.includes('Invalid role_type'))).toBe(true);
    });

    it('should warn on org role without org reference', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', 'org-admin,Org Admin,organization,read'].join(
          '\n',
        ),
      );

      const { definitions, warnings } = await parseRoleDefinitionsCsv(csvPath);

      expect(definitions).toHaveLength(0);
      expect(warnings.some((w) => w.includes('missing org_id'))).toBe(true);
    });

    it('should parse org roles with org_id', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        [
          'role_slug,role_name,role_type,permissions,org_id',
          'org-admin,Org Admin,organization,"read,write",org_123',
        ].join('\n'),
      );

      const { definitions } = await parseRoleDefinitionsCsv(csvPath);

      expect(definitions).toHaveLength(1);
      expect(definitions[0]!.orgId).toBe('org_123');
      expect(definitions[0]!.type).toBe('organization');
    });

    it('should deduplicate by slug within same scope', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        [
          'role_slug,role_name,role_type,permissions',
          'admin,Admin,environment,read',
          'admin,Admin Dupe,environment,"read,write"',
        ].join('\n'),
      );

      const { definitions, warnings } = await parseRoleDefinitionsCsv(csvPath);

      expect(definitions).toHaveLength(1);
      expect(definitions[0]!.name).toBe('Admin');
      expect(warnings.some((w) => w.includes('Duplicate'))).toBe(true);
    });

    it('should error on missing role_slug', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', ',Admin,environment,read'].join('\n'),
      );

      const { errors } = await parseRoleDefinitionsCsv(csvPath);

      expect(errors.some((e) => e.includes('Missing role_slug'))).toBe(true);
    });
  });

  describe('processRoleDefinitions', () => {
    it('should create environment roles', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', 'admin,Admin,environment,"read,write"'].join(
          '\n',
        ),
      );

      mockCreatePermission.mockResolvedValue(true);
      mockCreateEnvRole.mockResolvedValue({
        id: 'role_123',
        slug: 'admin',
        name: 'Admin',
        type: 'EnvironmentRole',
        permissions: [],
      });
      mockAssignPerms.mockResolvedValue(undefined);

      const summary = await processRoleDefinitions(csvPath, { dryRun: false });

      expect(summary.total).toBe(1);
      expect(summary.created).toBe(1);
      expect(mockCreateEnvRole).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'admin', name: 'Admin' }),
      );
      expect(mockAssignPerms).toHaveBeenCalledWith(
        expect.objectContaining({
          roleSlug: 'admin',
          permissions: ['read', 'write'],
        }),
      );
    });

    it('should create organization roles', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        [
          'role_slug,role_name,role_type,permissions,org_id',
          'org-admin,Org Admin,organization,manage,org_123',
        ].join('\n'),
      );

      mockCreatePermission.mockResolvedValue(true);
      mockListRoles.mockResolvedValue([]);
      mockCreateOrgRole.mockResolvedValue({
        id: 'role_456',
        slug: 'org-admin',
        name: 'Org Admin',
        type: 'OrganizationRole',
        permissions: [],
      });
      mockAssignPerms.mockResolvedValue(undefined);

      const summary = await processRoleDefinitions(csvPath, { dryRun: false });

      expect(summary.total).toBe(1);
      expect(summary.created).toBe(1);
      expect(mockCreateOrgRole).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org_123',
          slug: 'org-admin',
        }),
      );
    });

    it('should detect existing org roles', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        [
          'role_slug,role_name,role_type,permissions,org_id',
          'org-admin,Org Admin,organization,manage,org_123',
        ].join('\n'),
      );

      mockCreatePermission.mockResolvedValue(true);
      mockListRoles.mockResolvedValue([
        {
          id: 'role_existing',
          slug: 'org-admin',
          name: 'Org Admin',
          type: 'OrganizationRole',
          permissions: ['manage'],
        },
      ]);

      const summary = await processRoleDefinitions(csvPath, { dryRun: false });

      expect(summary.alreadyExist).toBe(1);
      expect(mockCreateOrgRole).not.toHaveBeenCalled();
    });

    it('should warn on permission mismatch for existing roles', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        [
          'role_slug,role_name,role_type,permissions,org_id',
          'org-admin,Org Admin,organization,"read,write",org_123',
        ].join('\n'),
      );

      mockCreatePermission.mockResolvedValue(true);
      mockListRoles.mockResolvedValue([
        {
          id: 'role_existing',
          slug: 'org-admin',
          name: 'Org Admin',
          type: 'OrganizationRole',
          permissions: ['read', 'delete'],
        },
      ]);

      const summary = await processRoleDefinitions(csvPath, { dryRun: false });

      expect(summary.alreadyExist).toBe(1);
      expect(summary.warnings.some((w) => w.includes('Permission mismatch'))).toBe(true);
    });

    it('should not call APIs in dry-run mode', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', 'admin,Admin,environment,read'].join('\n'),
      );

      const summary = await processRoleDefinitions(csvPath, { dryRun: true });

      expect(summary.total).toBe(1);
      expect(summary.created).toBe(1);
      expect(mockCreateEnvRole).not.toHaveBeenCalled();
      expect(mockCreatePermission).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', 'admin,Admin,environment,read'].join('\n'),
      );

      mockCreatePermission.mockResolvedValue(true);
      mockCreateEnvRole.mockRejectedValue(new Error('API error'));

      const summary = await processRoleDefinitions(csvPath, { dryRun: false });

      expect(summary.errors).toBe(1);
    });

    it('should treat 409 as exists for environment roles', async () => {
      const csvPath = path.join(tmpDir, 'roles.csv');
      fs.writeFileSync(
        csvPath,
        ['role_slug,role_name,role_type,permissions', 'admin,Admin,environment,read'].join('\n'),
      );

      mockCreatePermission.mockResolvedValue(true);
      const err = new Error('Role already exists') as any;
      err.status = 409;
      mockCreateEnvRole.mockRejectedValue(err);

      const summary = await processRoleDefinitions(csvPath, { dryRun: false });

      expect(summary.alreadyExist).toBe(1);
      expect(summary.errors).toBe(0);
    });
  });

  describe('assignRolesToUsers', () => {
    it('should assign roles via email lookup', async () => {
      const csvPath = path.join(tmpDir, 'mapping.csv');
      fs.writeFileSync(csvPath, ['email,role_slug', 'alice@example.com,admin'].join('\n'));

      const workos = {
        userManagement: {
          listUsers: jest.fn(async () => ({
            data: [{ id: 'user_alice', email: 'alice@example.com' }],
          })),
          listOrganizationMemberships: jest.fn(async () => ({
            data: [{ id: 'mem_123' }],
          })),
          updateOrganizationMembership: jest.fn(async () => ({})),
        },
      } as any;

      const result = await assignRolesToUsers(csvPath, workos, {
        orgId: 'org_123',
        dryRun: false,
      });

      expect(result.assigned).toBe(1);
      expect(workos.userManagement.updateOrganizationMembership).toHaveBeenCalledWith('mem_123', {
        roleSlugs: ['admin'],
      });
    });

    it('should handle user not found', async () => {
      const csvPath = path.join(tmpDir, 'mapping.csv');
      fs.writeFileSync(csvPath, ['email,role_slug', 'unknown@example.com,admin'].join('\n'));

      const workos = {
        userManagement: {
          listUsers: jest.fn(async () => ({ data: [] })),
        },
      } as any;

      const result = await assignRolesToUsers(csvPath, workos, {
        orgId: 'org_123',
        dryRun: false,
      });

      expect(result.userNotFound).toBe(1);
      expect(result.failures).toBe(1);
    });

    it('should not make API calls in dry-run mode', async () => {
      const csvPath = path.join(tmpDir, 'mapping.csv');
      fs.writeFileSync(csvPath, ['email,role_slug', 'alice@example.com,admin'].join('\n'));

      const workos = {
        userManagement: {
          listUsers: jest.fn(async () => ({
            data: [{ id: 'user_alice' }],
          })),
          listOrganizationMemberships: jest.fn(),
          updateOrganizationMembership: jest.fn(),
        },
      } as any;

      const result = await assignRolesToUsers(csvPath, workos, {
        orgId: 'org_123',
        dryRun: true,
      });

      expect(result.assigned).toBe(1);
      expect(workos.userManagement.listOrganizationMemberships).not.toHaveBeenCalled();
    });

    it('should handle no membership found', async () => {
      const csvPath = path.join(tmpDir, 'mapping.csv');
      fs.writeFileSync(csvPath, ['email,role_slug', 'alice@example.com,admin'].join('\n'));

      const workos = {
        userManagement: {
          listUsers: jest.fn(async () => ({
            data: [{ id: 'user_alice' }],
          })),
          listOrganizationMemberships: jest.fn(async () => ({ data: [] })),
        },
      } as any;

      const result = await assignRolesToUsers(csvPath, workos, {
        orgId: 'org_123',
        dryRun: false,
      });

      expect(result.failures).toBe(1);
      expect(result.warnings.some((w) => w.includes('No membership found'))).toBe(true);
    });
  });
});
