import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportFirebasePackage } from '../../../transformers/firebase/package-exporter';
import { getSource } from '../../registry';
import { expectByteIdenticalPackages } from '../../__tests__/tree-helper';
import { firebaseSource } from '../index';

const FIREBASE_JSON = JSON.stringify({
  users: [
    {
      localId: 'fb_alice',
      email: 'alice@acme.com',
      displayName: 'Alice Builder',
      emailVerified: true,
    },
    { localId: 'fb_disabled', email: 'sleeper@acme.com', displayName: 'Disabled', disabled: true },
    { localId: 'fb_no_email', displayName: 'No Email' },
  ],
});

const ORG_MAPPING = 'firebase_uid,org_external_id,org_name\nfb_alice,acme,Acme\n';
const ROLE_MAPPING = 'firebase_uid,role_slug\nfb_alice,admin\n';

describe('firebaseSource adapter', () => {
  it('is registered with file ingest and inline password hashes', () => {
    expect(getSource('firebase')).toBe(firebaseSource);
    expect(firebaseSource.capabilities.ingest).toBe('file');
    expect(firebaseSource.capabilities.passwords).toBe('hash-inline');
  });

  it('produces a package byte-identical to transform-firebase --package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'firebase-adapter-'));
    const input = path.join(root, 'firebase.json');
    const orgMapping = path.join(root, 'orgs.csv');
    const roleMapping = path.join(root, 'roles.csv');
    const legacyDir = path.join(root, 'legacy');
    const adapterDir = path.join(root, 'adapter');

    try {
      await fs.writeFile(input, FIREBASE_JSON);
      await fs.writeFile(orgMapping, ORG_MAPPING);
      await fs.writeFile(roleMapping, ROLE_MAPPING);

      await exportFirebasePackage({
        input,
        outputDir: legacyDir,
        nameSplitStrategy: 'first-space',
        includeDisabled: false,
        skipPasswords: false,
        orgMapping,
        roleMapping,
        sourceTenant: 'acme-firebase',
        quiet: true,
      });

      const result = await firebaseSource.export({
        credentials: {},
        options: {
          input,
          nameSplit: 'first-space',
          orgMapping,
          roleMapping,
          sourceTenant: 'acme-firebase',
        },
        outputDir: adapterDir,
        quiet: true,
      });

      expect(result.manifest.provider).toBe('firebase');
      await expectByteIdenticalPackages(legacyDir, adapterDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
