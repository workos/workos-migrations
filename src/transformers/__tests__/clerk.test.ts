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

const { transformClerkExport } = await import('../clerk/transformer.js');

describe('Clerk Transformer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should transform basic Clerk CSV to WorkOS format', async () => {
    const inputCsv = path.join(tmpDir, 'clerk.csv');
    const outputCsv = path.join(tmpDir, 'output.csv');

    fs.writeFileSync(
      inputCsv,
      [
        'id,first_name,last_name,primary_email_address,username,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher',
        'user_abc,Alice,Johnson,alice@example.com,alicej,+1555123,alice@example.com,,+1555123,,,$2a$10$someBcryptHash,bcrypt',
        'user_def,Bob,Smith,bob@example.com,bobs,,bob@example.com,,,,,,',
      ].join('\n'),
    );

    const summary = await transformClerkExport({
      input: inputCsv,
      output: outputCsv,
      quiet: true,
    });

    expect(summary.totalUsers).toBe(2);
    expect(summary.transformedUsers).toBe(2);
    expect(summary.skippedUsers).toBe(0);
    expect(summary.usersWithPasswords).toBe(1);
    expect(summary.usersWithoutPasswords).toBe(1);

    const output = fs.readFileSync(outputCsv, 'utf-8');
    expect(output).toContain('alice@example.com');
    expect(output).toContain('bob@example.com');
    expect(output).toContain('$2a$10$someBcryptHash');
    expect(output).toContain('bcrypt');
  });

  it('should skip users without primary_email_address', async () => {
    const inputCsv = path.join(tmpDir, 'clerk.csv');
    const outputCsv = path.join(tmpDir, 'output.csv');

    fs.writeFileSync(
      inputCsv,
      [
        'id,first_name,last_name,primary_email_address,username,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher',
        'user_abc,Alice,Johnson,alice@example.com,alicej,,,,,,,,',
        'user_def,Bob,Smith,,bobs,,,,,,,,',
      ].join('\n'),
    );

    const summary = await transformClerkExport({
      input: inputCsv,
      output: outputCsv,
      quiet: true,
    });

    expect(summary.totalUsers).toBe(2);
    expect(summary.transformedUsers).toBe(1);
    expect(summary.skippedUsers).toBe(1);
    expect(summary.skippedReasons['Missing primary_email_address']).toBe(1);
  });

  it('should warn about non-bcrypt passwords but still import the user', async () => {
    const inputCsv = path.join(tmpDir, 'clerk.csv');
    const outputCsv = path.join(tmpDir, 'output.csv');

    fs.writeFileSync(
      inputCsv,
      [
        'id,first_name,last_name,primary_email_address,username,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher',
        'user_abc,Alice,Johnson,alice@example.com,alicej,,,,,,,$argon2hash,argon2',
      ].join('\n'),
    );

    const summary = await transformClerkExport({
      input: inputCsv,
      output: outputCsv,
      quiet: true,
    });

    expect(summary.transformedUsers).toBe(1);
    expect(summary.usersWithoutPasswords).toBe(1);

    const output = fs.readFileSync(outputCsv, 'utf-8');
    expect(output).toContain('alice@example.com');
    // Password should not be in the output
    expect(output).not.toContain('$argon2hash');
  });

  it('should apply org mapping when provided', async () => {
    const inputCsv = path.join(tmpDir, 'clerk.csv');
    const orgCsv = path.join(tmpDir, 'orgs.csv');
    const outputCsv = path.join(tmpDir, 'output.csv');

    fs.writeFileSync(
      inputCsv,
      [
        'id,first_name,last_name,primary_email_address,username,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher',
        'user_abc,Alice,Johnson,alice@example.com,alicej,,,,,,,,',
        'user_def,Bob,Smith,bob@example.com,bobs,,,,,,,,',
      ].join('\n'),
    );

    fs.writeFileSync(
      orgCsv,
      [
        'clerk_user_id,org_external_id,org_name',
        'user_abc,org_ext_1,Acme Corp',
      ].join('\n'),
    );

    const summary = await transformClerkExport({
      input: inputCsv,
      output: outputCsv,
      orgMapping: orgCsv,
      quiet: true,
    });

    expect(summary.usersWithOrgMapping).toBe(1);
    expect(summary.usersWithoutOrgMapping).toBe(1);

    const output = fs.readFileSync(outputCsv, 'utf-8');
    expect(output).toContain('org_external_id');
    expect(output).toContain('org_ext_1');
    expect(output).toContain('Acme Corp');
  });

  it('should apply role mapping when provided', async () => {
    const inputCsv = path.join(tmpDir, 'clerk.csv');
    const roleCsv = path.join(tmpDir, 'roles.csv');
    const outputCsv = path.join(tmpDir, 'output.csv');

    fs.writeFileSync(
      inputCsv,
      [
        'id,first_name,last_name,primary_email_address,username,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher',
        'user_abc,Alice,Johnson,alice@example.com,alicej,,,,,,,,',
      ].join('\n'),
    );

    fs.writeFileSync(
      roleCsv,
      [
        'clerk_user_id,role_slug',
        'user_abc,admin',
        'user_abc,editor',
      ].join('\n'),
    );

    const summary = await transformClerkExport({
      input: inputCsv,
      output: outputCsv,
      roleMapping: roleCsv,
      quiet: true,
    });

    expect(summary.usersWithRoleMapping).toBe(1);

    const output = fs.readFileSync(outputCsv, 'utf-8');
    expect(output).toContain('role_slugs');
    expect(output).toContain('admin,editor');
  });

  it('should include metadata with clerk fields', async () => {
    const inputCsv = path.join(tmpDir, 'clerk.csv');
    const outputCsv = path.join(tmpDir, 'output.csv');

    fs.writeFileSync(
      inputCsv,
      [
        'id,first_name,last_name,primary_email_address,username,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher',
        'user_abc,Alice,Johnson,alice@example.com,alicej,+1555123,alice@example.com,,+1555123,,secret123,,',
      ].join('\n'),
    );

    const summary = await transformClerkExport({
      input: inputCsv,
      output: outputCsv,
      quiet: true,
    });

    expect(summary.transformedUsers).toBe(1);

    const output = fs.readFileSync(outputCsv, 'utf-8');
    expect(output).toContain('clerk_user_id');
    expect(output).toContain('alicej');
    expect(output).toContain('totp_secret');
  });
});
