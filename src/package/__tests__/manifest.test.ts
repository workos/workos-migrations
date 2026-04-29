import {
  DEFAULT_IMPORTABILITY,
  MIGRATION_PACKAGE_FILES,
  createMigrationPackageManifest,
} from '../manifest';

describe('createMigrationPackageManifest', () => {
  it('creates a deterministic provider-neutral manifest', () => {
    const manifest = createMigrationPackageManifest({
      provider: 'auth0',
      sourceTenant: 'example.us.auth0.com',
      generatedAt: new Date('2026-04-29T00:00:00.000Z'),
      entitiesRequested: ['users', 'organizations', 'sso'],
      entitiesExported: {
        users: 10,
        organizations: 2,
      },
      warnings: ['Missing domains for one connection'],
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      provider: 'auth0',
      sourceTenant: 'example.us.auth0.com',
      generatedAt: '2026-04-29T00:00:00.000Z',
      entitiesRequested: ['users', 'organizations', 'sso'],
      files: MIGRATION_PACKAGE_FILES,
      importability: DEFAULT_IMPORTABILITY,
      secretsRedacted: true,
      warnings: ['Missing domains for one connection'],
    });
    expect(manifest.entitiesExported.users).toBe(10);
    expect(manifest.entitiesExported.organizations).toBe(2);
    expect(manifest.entitiesExported.samlConnections).toBe(0);
  });

  it('preserves explicit secret redaction metadata', () => {
    const manifest = createMigrationPackageManifest({
      provider: 'auth0',
      generatedAt: '2026-04-29T00:00:00.000Z',
      secretsRedacted: false,
      secretRedaction: {
        mode: 'included',
        redacted: false,
        redactedFields: [],
        files: ['sso/oidc_connections.csv'],
      },
    });

    expect(manifest.secretsRedacted).toBe(false);
    expect(manifest.secretRedaction).toEqual({
      mode: 'included',
      redacted: false,
      redactedFields: [],
      files: ['sso/oidc_connections.csv'],
    });
  });
});
