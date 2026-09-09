import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import type { WorkOS } from '@workos-inc/node';
import { CheckpointManager } from '../checkpoint.js';
import {
  DEFAULT_IMPORT_RATE_LIMIT,
  retryCreateMembership,
  retryCreateUser,
  runImport,
} from '../importer.js';

describe('import concurrency and aggregate request rate', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'import-rate-test-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(['streaming', 'checkpointed'])(
    'limits active work and user plus membership writes in %s mode',
    async (mode) => {
      const csvPath = path.join(root, 'users.csv');
      fs.writeFileSync(
        csvPath,
        'email\n' + Array.from({ length: 30 }, (_, i) => `user${i}@example.com`).join('\n'),
      );
      let active = 0;
      let peak = 0;
      const requests: number[] = [];
      const request = async () => {
        requests.push(Date.now());
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
      };
      const createUser = jest.fn(async ({ email }: { email: string }) => {
        await request();
        if (email === 'user0@example.com') {
          throw Object.assign(new Error('Email address is invalid'), { status: 400 });
        }
        return { id: `user_${email}` };
      });
      const createOrganizationMembership = jest.fn(request);
      const workos = {
        userManagement: { createUser, createOrganizationMembership },
      } as unknown as WorkOS;
      const checkpointManager =
        mode === 'checkpointed'
          ? await CheckpointManager.create({
              jobId: 'test',
              csvPath,
              csvHash: 'fixture',
              totalRows: 30,
              chunkSize: 2,
              concurrency: 3,
              mode: 'single-org',
              orgId: 'org_test',
              checkpointDir: root,
            })
          : undefined;
      const errorsPath = path.join(root, 'errors.jsonl');
      const result = await runImport({
        csvPath,
        workos,
        concurrency: 3,
        rateLimit: DEFAULT_IMPORT_RATE_LIMIT,
        orgId: 'org_test',
        createOrgIfMissing: false,
        dryRun: false,
        dedupe: false,
        quiet: true,
        errorsPath,
        checkpointManager,
      });

      expect(result).toMatchObject({ usersCreated: 29, membershipsCreated: 29, errors: 1 });
      // Per-row failures only reach the operator through the error file:
      // errorsPath in streaming mode, the checkpoint dir in chunked mode.
      const errorFile =
        mode === 'checkpointed'
          ? path.join(checkpointManager!.getCheckpointDir(), 'errors.jsonl')
          : errorsPath;
      const errors = fs
        .readFileSync(errorFile, 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(errors).toEqual([
        expect.objectContaining({
          email: 'user0@example.com',
          errorType: 'user_create',
          errorMessage: expect.stringContaining('Email address is invalid'),
        }),
      ]);
      expect(peak).toBeLessThanOrEqual(3);
      expect(peak).toBeGreaterThan(1);
      expect(requests).toHaveLength(59);
      const minDuration =
        ((requests.length - DEFAULT_IMPORT_RATE_LIMIT) / DEFAULT_IMPORT_RATE_LIMIT) * 1000;
      expect(requests.at(-1)! - requests[0]).toBeGreaterThanOrEqual(minDuration - 25);
    },
  );
});

describe('user and membership retries', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['user', 'membership', 'role-fallback'])(
    'honors SDK retryAfter and rate limits every %s attempt',
    async (kind) => {
      const call = jest.fn<() => Promise<{ id: string }>>();
      if (kind === 'role-fallback') {
        call.mockRejectedValueOnce({ status: 422, code: 'multiple_roles_not_enabled' });
      }
      call
        .mockRejectedValueOnce({ status: 429, retryAfter: 2 })
        .mockResolvedValue({ id: 'user_test' });
      const workos = {
        userManagement: { createUser: call, createOrganizationMembership: call },
      } as unknown as WorkOS;
      const limiter = { acquire: jest.fn(async () => {}) };
      const pending =
        kind === 'user'
          ? retryCreateUser(workos, { email: 'test@example.com' }, limiter)
          : retryCreateMembership(
              workos,
              'user_test',
              'org_test',
              limiter,
              kind === 'role-fallback' ? ['admin', 'member'] : undefined,
            );
      const initialCalls = kind === 'role-fallback' ? 2 : 1;
      await jest.advanceTimersByTimeAsync(1999);
      expect(call).toHaveBeenCalledTimes(initialCalls);
      await jest.advanceTimersByTimeAsync(1);
      await pending;
      expect(call).toHaveBeenCalledTimes(initialCalls + 1);
      expect(limiter.acquire).toHaveBeenCalledTimes(initialCalls + 1);
    },
  );
});
