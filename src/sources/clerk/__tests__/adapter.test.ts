import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportClerkPackage } from '../../../transformers/clerk/package-exporter';
import { getSource } from '../../registry';
import { expectByteIdenticalPackages } from '../../__tests__/tree-helper';
import { clerkSource } from '../index';

const CLERK_CSV = [
  'id,primary_email_address,first_name,last_name,password_hasher,password_digest,username',
  'user_alice,alice@acme.com,Alice,Builder,bcrypt,$2a$10$alicehash,alice',
  'user_bob,bob@acme.com,Bob,,scrypt,$scrypt$bobhash,bob',
].join('\n');

const ORG_MAPPING =
  'clerk_user_id,org_external_id,org_name\nuser_alice,acme,Acme\nuser_bob,acme,Acme\n';
const ROLE_MAPPING = 'clerk_user_id,role_slug\nuser_alice,admin\nuser_bob,member\n';

describe('clerkSource adapter', () => {
  it('is registered with file ingest, inline password hashes, and SSO support', () => {
    expect(getSource('clerk')).toBe(clerkSource);
    expect(clerkSource.capabilities.ingest).toBe('file');
    expect(clerkSource.capabilities.passwords).toBe('hash-inline');
    expect(clerkSource.capabilities.saml).toBe(true);
    expect(clerkSource.capabilities.oidc).toBe(true);
  });

  it('produces a package byte-identical to transform-clerk --package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-adapter-'));
    const input = path.join(root, 'clerk.csv');
    const orgMapping = path.join(root, 'orgs.csv');
    const roleMapping = path.join(root, 'roles.csv');
    const legacyDir = path.join(root, 'legacy');
    const adapterDir = path.join(root, 'adapter');

    try {
      await fs.writeFile(input, CLERK_CSV);
      await fs.writeFile(orgMapping, ORG_MAPPING);
      await fs.writeFile(roleMapping, ROLE_MAPPING);

      await exportClerkPackage({
        input,
        outputDir: legacyDir,
        orgMapping,
        roleMapping,
        sourceTenant: 'acme-clerk',
        quiet: true,
      });

      const result = await clerkSource.export({
        credentials: {},
        options: { input, orgMapping, roleMapping, sourceTenant: 'acme-clerk' },
        outputDir: adapterDir,
        quiet: true,
      });

      expect(result.manifest.provider).toBe('clerk');
      await expectByteIdenticalPackages(legacyDir, adapterDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('forwards the secret key + fetch impl to export Clerk enterprise SSO connections', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clerk-sso-'));
    const input = path.join(root, 'clerk.csv');
    const outputDir = path.join(root, 'pkg');

    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'ec_saml_okta',
              name: 'Acme Okta',
              domains: ['acme.com'],
              organization_id: 'org_acme',
              saml_connection: {
                idp_entity_id: 'https://acme.okta.com/exk1',
                idp_sso_url: 'https://acme.okta.com/sso/saml',
                idp_certificate: 'CERTDATA',
                acs_url: 'https://clerk.acme.com/acs',
                sp_entity_id: 'https://clerk.acme.com/saml',
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    try {
      await fs.writeFile(
        input,
        'id,primary_email_address,first_name\nuser_solo,solo@acme.com,Solo\n',
      );

      const result = await clerkSource.export({
        credentials: { secretKey: 'sk_test_abc' },
        options: { input },
        outputDir,
        quiet: true,
        client: { fetchImpl },
      });

      expect(result.manifest.entitiesExported.samlConnections).toBe(1);
      const saml = await fs.readFile(path.join(outputDir, 'sso', 'saml_connections.csv'), 'utf-8');
      expect(saml).toContain('https://acme.okta.com/exk1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
