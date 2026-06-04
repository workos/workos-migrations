import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Auth0Organization, Auth0User } from '../../../shared/types';
import {
  exportAuth0PackageWithClient,
  type Auth0ExportClient,
} from '../../../exporters/auth0/package-exporter';
import { getSource } from '../../registry';
import { auth0Source } from '../index';

const org: Auth0Organization = {
  id: 'org_acme',
  name: 'acme',
  display_name: 'Acme',
};

const user: Auth0User = {
  user_id: 'auth0|alice',
  email: 'alice@example.com',
  email_verified: true,
  given_name: 'Alice',
  family_name: 'Builder',
  created_at: '2020-01-01T00:00:00.000Z',
  updated_at: '2020-01-02T00:00:00.000Z',
};

/**
 * Minimal client covering the default management-api organizations path:
 * list orgs -> list members per org -> fetch each user. No connections/roles,
 * so the optional methods are intentionally absent.
 */
class FakeAuth0Client implements Auth0ExportClient {
  async getOrganizations(page = 0): Promise<Auth0Organization[]> {
    return page === 0 ? [org] : [];
  }

  async getOrganizationMembers(orgId: string, page = 0): Promise<Array<{ user_id: string }>> {
    return page === 0 && orgId === org.id ? [{ user_id: user.user_id }] : [];
  }

  async getUser(userId: string): Promise<Auth0User | null> {
    return userId === user.user_id ? user : null;
  }

  async getUsers(): Promise<Auth0User[]> {
    return [];
  }
}

const credentials = {
  domain: 'example.us.auth0.com',
  clientId: 'client_123',
  clientSecret: 'secret',
};

async function readTree(dir: string): Promise<Map<string, Buffer>> {
  const tree = new Map<string, Buffer>();
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        tree.set(path.relative(dir, full), await fs.readFile(full));
      }
    }
  }
  await walk(dir);
  return tree;
}

describe('auth0Source adapter', () => {
  it('is registered under "auth0"', () => {
    expect(getSource('auth0')).toBe(auth0Source);
    expect(auth0Source.capabilities.ingest).toBe('api');
    expect(auth0Source.credentials.map((c) => c.key)).toEqual([
      'clientId',
      'clientSecret',
      'domain',
    ]);
  });

  it('produces a package byte-identical to export-auth0 --package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auth0-adapter-'));
    const legacyDir = path.join(root, 'legacy');
    const adapterDir = path.join(root, 'adapter');

    try {
      // Legacy path: exactly what `export-auth0 --package` invokes under the hood.
      const summary = await exportAuth0PackageWithClient(new FakeAuth0Client(), {
        domain: credentials.domain,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        package: true,
        outputDir: legacyDir,
        entities: ['users', 'organizations', 'memberships'],
        pageSize: 100,
        rateLimit: 50,
        userFetchConcurrency: 2,
        useMetadata: false,
        quiet: true,
      });

      // Adapter path: same client + equivalent options through the contract.
      const result = await auth0Source.export({
        credentials,
        options: {
          entities: ['users', 'organizations', 'memberships'],
          pageSize: 100,
          rateLimit: 50,
          userFetchConcurrency: 2,
          useMetadata: false,
        },
        outputDir: adapterDir,
        quiet: true,
        client: new FakeAuth0Client(),
      });

      expect(result.outputDir).toBe(path.resolve(adapterDir));
      expect(result.manifest.provider).toBe('auth0');
      expect(result.manifest.entitiesExported).toMatchObject({
        users: summary.totalUsers,
        organizations: summary.totalOrgs,
      });
      expect(typeof result.durationMs).toBe('number');

      const legacyTree = await readTree(legacyDir);
      const adapterTree = await readTree(adapterDir);

      // Same set of files in the same relative locations.
      expect([...adapterTree.keys()].sort()).toEqual([...legacyTree.keys()].sort());

      for (const [rel, adapterBytes] of adapterTree) {
        const legacyBytes = legacyTree.get(rel)!;
        if (rel === 'manifest.json') {
          // Identical except the non-deterministic generatedAt timestamp.
          const a = JSON.parse(adapterBytes.toString('utf-8'));
          const b = JSON.parse(legacyBytes.toString('utf-8'));
          delete a.generatedAt;
          delete b.generatedAt;
          expect(a).toEqual(b);
        } else {
          expect(adapterBytes.equals(legacyBytes)).toBe(true);
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
