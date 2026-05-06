import { gzipSync } from 'node:zlib';
import { parseAuth0BulkExportPayload, runAuth0BulkUserExport } from '../bulk-export';
import type { Auth0Job, Auth0User } from '../../../shared/types';

describe('parseAuth0BulkExportPayload', () => {
  it('parses NDJSON text payload', () => {
    const payload = [
      JSON.stringify({ user_id: 'auth0|1', email: 'a@example.com' }),
      '',
      'not-json',
      JSON.stringify({ user_id: 'auth0|2', email: 'b@example.com' }),
    ].join('\n');

    expect(parseAuth0BulkExportPayload(payload).map((user) => user.user_id)).toEqual([
      'auth0|1',
      'auth0|2',
    ]);
  });

  it('decodes gzipped buffers', () => {
    const ndjson = `${JSON.stringify({ user_id: 'auth0|gz', email: 'gz@example.com' })}\n`;
    const buffer = gzipSync(Buffer.from(ndjson, 'utf-8'));
    const users = parseAuth0BulkExportPayload(buffer);
    expect(users).toEqual([{ user_id: 'auth0|gz', email: 'gz@example.com' }]);
  });
});

describe('runAuth0BulkUserExport', () => {
  it('polls until completion and returns parsed users', async () => {
    const created: Auth0Job = {
      id: 'job_1',
      type: 'users_export',
      status: 'pending',
    };
    const completed: Auth0Job = {
      id: 'job_1',
      type: 'users_export',
      status: 'completed',
      location: 'https://example.com/export.ndjson',
    };

    const sleeps: number[] = [];
    const userPayload = [
      JSON.stringify({ user_id: 'auth0|1', email: 'a@example.com' }),
      JSON.stringify({ user_id: 'auth0|2', email: 'b@example.com' }),
    ].join('\n');

    let getJobCalls = 0;
    const result = await runAuth0BulkUserExport(
      {
        async createUserExportJob() {
          return created;
        },
        async getJob(jobId: string) {
          expect(jobId).toBe('job_1');
          getJobCalls += 1;
          return getJobCalls === 1
            ? { ...created, status: 'processing' as Auth0Job['status'] }
            : completed;
        },
        async downloadJobLocation(location: string) {
          expect(location).toBe('https://example.com/export.ndjson');
          return userPayload;
        },
      },
      {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        pollIntervalMs: 100,
      },
    );

    expect(sleeps).toEqual([100, 100]);
    expect(result.pollAttempts).toBe(2);
    expect(result.users.map((user: Auth0User) => user.email)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('throws when the job fails', async () => {
    await expect(
      runAuth0BulkUserExport(
        {
          async createUserExportJob() {
            return {
              id: 'job_2',
              type: 'users_export',
              status: 'pending',
            } satisfies Auth0Job;
          },
          async getJob() {
            return {
              id: 'job_2',
              type: 'users_export',
              status: 'failed',
              error: 'connection limit exceeded',
            } satisfies Auth0Job;
          },
          async downloadJobLocation() {
            return '';
          },
        },
        {
          sleep: async () => {},
          pollIntervalMs: 1,
        },
      ),
    ).rejects.toThrow('connection limit exceeded');
  });

  it('throws when no location is provided', async () => {
    await expect(
      runAuth0BulkUserExport(
        {
          async createUserExportJob() {
            return {
              id: 'job_3',
              type: 'users_export',
              status: 'completed',
            } satisfies Auth0Job;
          },
          async getJob() {
            return {
              id: 'job_3',
              type: 'users_export',
              status: 'completed',
            } satisfies Auth0Job;
          },
          async downloadJobLocation() {
            return '';
          },
        },
        {
          sleep: async () => {},
          pollIntervalMs: 1,
        },
      ),
    ).rejects.toThrow('completed without a download location');
  });
});
