import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { toNumber, validateSourceContext } from '../util';
import { auth0Source } from '../auth0/index';
import { cognitoSource } from '../cognito/index';
import { clerkSource } from '../clerk/index';
import { firebaseSource } from '../firebase/index';

const base = { options: {}, outputDir: '/tmp/unused', credentials: {} };

describe('toNumber', () => {
  it('falls back on empty, missing, and non-numeric input', () => {
    expect(toNumber('', 100)).toBe(100);
    expect(toNumber('abc', 50)).toBe(50);
    expect(toNumber(undefined, 10)).toBe(10);
    expect(toNumber(null, 10)).toBe(10);
  });

  it('passes through real numbers, including zero', () => {
    expect(toNumber('25', 10)).toBe(25);
    expect(toNumber(0, 10)).toBe(0);
  });
});

describe('validateSourceContext', () => {
  it('rejects missing required credentials', () => {
    expect(() => validateSourceContext(auth0Source, { ...base })).toThrow(/Client ID/);
  });

  it('rejects empty-string required credentials (e.g. AWS_REGION="")', () => {
    expect(() =>
      validateSourceContext(cognitoSource, {
        ...base,
        credentials: { region: '', userPoolIds: 'us-east-1_acme' },
      }),
    ).toThrow(/AWS Region/);
  });

  it('rejects values outside a declared choices set', () => {
    expect(() =>
      validateSourceContext(cognitoSource, {
        ...base,
        credentials: { region: 'us-east-1', userPoolIds: 'us-east-1_acme' },
        options: { orgStrategy: 'bogus' },
      }),
    ).toThrow(/must be one of: user-pool, connection, none/);
  });

  it('rejects missing required options', () => {
    expect(() => validateSourceContext(clerkSource, { ...base })).toThrow(/input/);
  });

  it('rejects file options pointing at nonexistent paths', () => {
    expect(() =>
      validateSourceContext(clerkSource, {
        ...base,
        options: { input: '/nonexistent/clerk.csv' },
      }),
    ).toThrow(/Clerk export CSV not found/);
  });
});

describe('adapter validation integration', () => {
  it('clerkSource.export rejects a missing input file before doing any work', async () => {
    await expect(
      clerkSource.export({
        credentials: {},
        options: { input: '/nonexistent/clerk.csv' },
        outputDir: '/tmp/should-not-be-written',
        quiet: true,
      }),
    ).rejects.toThrow(/not found/);
  });

  it('firebaseSource.export fails loudly when SSO is requested but no project ID resolves', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-validate-'));
    const input = path.join(root, 'firebase.json');
    await fs.writeFile(input, JSON.stringify({ users: [] }));

    const prevGoogle = process.env.GOOGLE_CLOUD_PROJECT;
    const prevGcloud = process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    try {
      await expect(
        firebaseSource.export({
          credentials: {},
          options: { input },
          outputDir: path.join(root, 'pkg'),
          quiet: true,
          client: { accessTokenProvider: { getAccessToken: async () => 'token' } },
        }),
      ).rejects.toThrow(/project ID is required/);
    } finally {
      if (prevGoogle !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevGoogle;
      if (prevGcloud !== undefined) process.env.GCLOUD_PROJECT = prevGcloud;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('firebaseSource.export resolves the project ID from GCLOUD_PROJECT', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fb-gcloud-'));
    const input = path.join(root, 'firebase.json');
    await fs.writeFile(input, JSON.stringify({ users: [{ localId: 'u1', email: 'u@x.com' }] }));

    const prevGoogle = process.env.GOOGLE_CLOUD_PROJECT;
    const prevGcloud = process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GCLOUD_PROJECT = 'acme';

    const fetchImpl = (async (req: RequestInfo | URL) => {
      const url = typeof req === 'string' ? req : req.toString();
      if (url.includes('/inboundSamlConfigs')) {
        return new Response(
          JSON.stringify({
            inboundSamlConfigs: [
              {
                name: 'projects/acme/inboundSamlConfigs/saml.project',
                displayName: 'Project SAML',
                idpConfig: {
                  idpEntityId: 'https://idp.example/exk',
                  ssoUrl: 'https://idp.example/sso',
                  idpCertificates: [{ x509Certificate: 'CERT' }],
                },
                spConfig: { spEntityId: 'sp', callbackUri: 'https://cb' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ oauthIdpConfigs: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const result = await firebaseSource.export({
        credentials: {},
        options: { input, skipTenantSso: true },
        outputDir: path.join(root, 'pkg'),
        quiet: true,
        client: { accessTokenProvider: { getAccessToken: async () => 'token' }, fetchImpl },
      });
      expect(result.manifest.entitiesExported.samlConnections).toBe(1);
    } finally {
      if (prevGoogle !== undefined) process.env.GOOGLE_CLOUD_PROJECT = prevGoogle;
      if (prevGcloud !== undefined) process.env.GCLOUD_PROJECT = prevGcloud;
      else delete process.env.GCLOUD_PROJECT;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
