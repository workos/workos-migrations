import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { jest } from '@jest/globals';

// Mock logger to avoid chalk ESM issues
jest.unstable_mockModule('../../shared/logger.js', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
}));

const { enrollTotp } = await import('../enroller.js');

// Create a mock WorkOS client
function createMockWorkOS(users: Record<string, string> = {}) {
  return {
    userManagement: {
      listUsers: jest.fn(async ({ email }: { email: string }) => {
        const userId = users[email];
        return {
          data: userId ? [{ id: userId, email }] : [],
        };
      }),
      enrollAuthFactor: jest.fn(async () => ({
        authenticationFactor: { id: 'factor_123', type: 'totp' },
      })),
      listOrganizationMemberships: jest.fn(),
      updateOrganizationMembership: jest.fn(),
    },
  } as any;
}

describe('TOTP Enroller', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totp-enroller-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should enroll TOTP factors for found users', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(
      inputPath,
      [
        'email,totp_secret',
        'alice@example.com,JBSWY3DPEHPK3PXP',
        'bob@example.com,KRSXG5CTMVRXEZLU',
      ].join('\n'),
    );

    const workos = createMockWorkOS({
      'alice@example.com': 'user_alice',
      'bob@example.com': 'user_bob',
    });

    const { summary } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      quiet: true,
    });

    expect(summary.total).toBe(2);
    expect(summary.enrolled).toBe(2);
    expect(summary.failures).toBe(0);
    expect(workos.userManagement.enrollAuthFactor).toHaveBeenCalledTimes(2);
  });

  it('should handle user not found gracefully', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(inputPath, ['email,totp_secret', 'unknown@example.com,SECRET123'].join('\n'));

    const workos = createMockWorkOS({});

    const { summary } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      quiet: true,
    });

    expect(summary.total).toBe(1);
    expect(summary.enrolled).toBe(0);
    expect(summary.userNotFound).toBe(1);
    expect(summary.failures).toBe(1);
  });

  it('should skip already-enrolled users', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(inputPath, ['email,totp_secret', 'alice@example.com,SECRET123'].join('\n'));

    const workos = createMockWorkOS({ 'alice@example.com': 'user_alice' });
    workos.userManagement.enrollAuthFactor.mockRejectedValueOnce(
      new Error('TOTP factor already enrolled'),
    );

    const { summary } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      quiet: true,
    });

    expect(summary.total).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failures).toBe(0);
  });

  it('should not call APIs in dry-run mode', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(inputPath, ['email,totp_secret', 'alice@example.com,SECRET123'].join('\n'));

    const workos = createMockWorkOS({ 'alice@example.com': 'user_alice' });

    const { summary } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: true,
      quiet: true,
    });

    expect(summary.total).toBe(1);
    expect(summary.enrolled).toBe(1);
    expect(workos.userManagement.enrollAuthFactor).not.toHaveBeenCalled();
  });

  it('should handle enrollment API errors', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(inputPath, ['email,totp_secret', 'alice@example.com,SECRET123'].join('\n'));

    const workos = createMockWorkOS({ 'alice@example.com': 'user_alice' });
    workos.userManagement.enrollAuthFactor.mockRejectedValueOnce(
      new Error('Internal server error'),
    );

    const { summary } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      quiet: true,
    });

    expect(summary.total).toBe(1);
    expect(summary.failures).toBe(1);
  });

  it('should pass totpIssuer to enrollAuthFactor', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(inputPath, ['email,totp_secret', 'alice@example.com,SECRET123'].join('\n'));

    const workos = createMockWorkOS({ 'alice@example.com': 'user_alice' });

    await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      totpIssuer: 'MyApp',
      quiet: true,
    });

    expect(workos.userManagement.enrollAuthFactor).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_alice',
        type: 'totp',
        totpSecret: 'SECRET123',
        totpIssuer: 'MyApp',
      }),
    );
  });

  it('should write errors to file when errorsPath is set', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    const errorsPath = path.join(tmpDir, 'errors.jsonl');
    fs.writeFileSync(inputPath, ['email,totp_secret', 'unknown@example.com,SECRET123'].join('\n'));

    const workos = createMockWorkOS({});

    const { errors } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      errorsPath,
      quiet: true,
    });

    // Errors written to file, not returned in array
    expect(errors).toHaveLength(0);

    const errorContent = fs.readFileSync(errorsPath, 'utf-8');
    expect(errorContent).toContain('unknown@example.com');
    expect(errorContent).toContain('user_lookup');
  });

  it('should handle empty input file', async () => {
    const inputPath = path.join(tmpDir, 'totp.csv');
    fs.writeFileSync(inputPath, 'email,totp_secret\n');

    const workos = createMockWorkOS({});

    const { summary } = await enrollTotp(workos, {
      inputPath,
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      quiet: true,
    });

    expect(summary.total).toBe(0);
    expect(summary.enrolled).toBe(0);
  });

  it('should handle NDJSON input format', async () => {
    const inputPath = path.join(tmpDir, 'totp.jsonl');
    fs.writeFileSync(
      inputPath,
      [
        '{"email":"alice@example.com","totp_secret":"SECRET123"}',
        '{"email":"bob@example.com","mfa_factors":[{"type":"totp","secret":"SECRET456"}]}',
      ].join('\n'),
    );

    const workos = createMockWorkOS({
      'alice@example.com': 'user_alice',
      'bob@example.com': 'user_bob',
    });

    const { summary } = await enrollTotp(workos, {
      inputPath,
      format: 'ndjson',
      concurrency: 1,
      rateLimit: 100,
      dryRun: false,
      quiet: true,
    });

    expect(summary.total).toBe(2);
    expect(summary.enrolled).toBe(2);
  });
});
