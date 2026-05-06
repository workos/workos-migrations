import { gunzipSync } from 'node:zlib';
import type { Auth0Job, Auth0User, Auth0UserExportField } from '../../shared/types.js';

export interface BulkExportClient {
  createUserExportJob(options?: {
    connectionId?: string;
    format?: 'json' | 'csv';
    limit?: number;
    fields?: Auth0UserExportField[];
  }): Promise<Auth0Job>;
  getJob(jobId: string): Promise<Auth0Job>;
  downloadJobLocation(location: string): Promise<string | ArrayBuffer | Uint8Array>;
}

export interface RunAuth0BulkExportOptions {
  connectionId?: string;
  fields?: Auth0UserExportField[];
  /** How many ms to wait between job-status polls. Defaults to 2_000. */
  pollIntervalMs?: number;
  /** Maximum poll attempts. Defaults to 150 (~5 minutes at 2s). */
  maxPollAttempts?: number;
  /** Optional sleep injection for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RunAuth0BulkExportResult {
  job: Auth0Job;
  users: Auth0User[];
  pollAttempts: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 150;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function runAuth0BulkUserExport(
  client: BulkExportClient,
  options: RunAuth0BulkExportOptions = {},
): Promise<RunAuth0BulkExportResult> {
  const sleep = options.sleep ?? defaultSleep;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

  const initial = await client.createUserExportJob({
    format: 'json',
    ...(options.connectionId ? { connectionId: options.connectionId } : {}),
    ...(options.fields ? { fields: options.fields } : {}),
  });

  let job = initial;
  let attempts = 0;

  while (job.status !== 'completed' && job.status !== 'failed') {
    if (attempts >= maxPollAttempts) {
      throw new Error(
        `Auth0 bulk export job ${job.id} did not finish after ${attempts} polls (last status: ${job.status}).`,
      );
    }
    await sleep(pollIntervalMs);
    attempts += 1;
    job = await client.getJob(job.id);
  }

  if (job.status === 'failed') {
    throw new Error(
      `Auth0 bulk export job ${job.id} failed: ${job.error ?? 'no error message provided'}`,
    );
  }

  if (!job.location) {
    throw new Error(`Auth0 bulk export job ${job.id} completed without a download location.`);
  }

  const payload = await client.downloadJobLocation(job.location);
  const users = parseAuth0BulkExportPayload(payload);

  return {
    job,
    users,
    pollAttempts: attempts,
  };
}

export function parseAuth0BulkExportPayload(
  payload: string | ArrayBuffer | Uint8Array,
): Auth0User[] {
  const text = decodePayload(payload);
  const users: Auth0User[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Auth0User;
      users.push(parsed);
    } catch {
      // Skip malformed lines so a single bad row does not abort the whole export.
    }
  }

  return users;
}

function decodePayload(payload: string | ArrayBuffer | Uint8Array): string {
  if (typeof payload === 'string') return payload;
  const buffer =
    payload instanceof Uint8Array ? Buffer.from(payload) : Buffer.from(new Uint8Array(payload));
  if (looksLikeGzip(buffer)) {
    return gunzipSync(buffer).toString('utf-8');
  }
  return buffer.toString('utf-8');
}

function looksLikeGzip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}
