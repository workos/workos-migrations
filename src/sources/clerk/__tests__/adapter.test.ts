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
  it('is registered with file ingest and inline password hashes', () => {
    expect(getSource('clerk')).toBe(clerkSource);
    expect(clerkSource.capabilities.ingest).toBe('file');
    expect(clerkSource.capabilities.passwords).toBe('hash-inline');
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
});
