import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportCognitoPackage } from '../../../providers/cognito/package-exporter';
import type { CognitoUser } from '../../../providers/cognito/workos-csv';
import { getSource } from '../../registry';
import { expectByteIdenticalPackages } from '../../__tests__/tree-helper';
import { cognitoSource, type CognitoExportClient } from '../index';

const acmeUser: CognitoUser = {
  userPoolId: 'us-east-1_acme',
  username: 'cognito-uuid-1',
  attributes: {
    sub: 'cognito-uuid-1',
    email: 'alice@acme.com',
    email_verified: 'true',
    given_name: 'Alice',
    family_name: 'Builder',
  },
  userStatus: 'CONFIRMED',
  enabled: true,
};

const fixture = { providers: [], users: [acmeUser] };

function runExport(outputDir: string) {
  return exportCognitoPackage(fixture, {
    outputDir,
    entities: ['users', 'organizations', 'memberships'],
    orgStrategy: 'user-pool',
    skipExternalProviderUsers: true,
    quiet: true,
  });
}

describe('cognitoSource adapter', () => {
  it('is registered with api ingest and no password export', () => {
    expect(getSource('cognito')).toBe(cognitoSource);
    expect(cognitoSource.capabilities.ingest).toBe('api');
    expect(cognitoSource.capabilities.passwords).toBe('none');
  });

  it('produces a package byte-identical to export-cognito --package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cognito-adapter-'));
    const legacyDir = path.join(root, 'legacy');
    const adapterDir = path.join(root, 'adapter');

    try {
      await runExport(legacyDir);

      // Fake client mirrors CognitoClient: authenticate() then exportPackage(),
      // delegating to the same exporter with the same fixture inputs.
      const fakeClient: CognitoExportClient = {
        authenticate: async () => {},
        exportPackage: async (o) =>
          exportCognitoPackage(fixture, {
            outputDir: o.outputDir!,
            entities: o.entities!,
            orgStrategy: o.orgStrategy!,
            skipExternalProviderUsers: true,
            quiet: o.quiet,
          }),
      };

      const result = await cognitoSource.export({
        credentials: { region: 'us-east-1', userPoolIds: 'us-east-1_acme' },
        options: { entities: ['users', 'organizations', 'memberships'], orgStrategy: 'user-pool' },
        outputDir: adapterDir,
        quiet: true,
        client: fakeClient,
      });

      expect(result.manifest.provider).toBe('cognito');
      expect(typeof result.durationMs).toBe('number');
      await expectByteIdenticalPackages(legacyDir, adapterDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
