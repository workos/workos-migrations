import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  CheckpointState,
  ChunkMetadata,
  ChunkSummary,
  CreateCheckpointOptions,
  ImportSummary,
} from '../shared/types.js';
import { OrgCache } from './org-cache.js';

const DEFAULT_CHECKPOINT_DIR = '.workos-checkpoints';

export class CheckpointManager {
  private readonly checkpointDir: string;
  private readonly jobId: string;
  private state: CheckpointState;
  private readonly checkpointPath: string;

  private constructor(jobId: string, state: CheckpointState, checkpointDir: string) {
    this.jobId = jobId;
    this.state = state;
    this.checkpointDir = path.join(checkpointDir, jobId);
    this.checkpointPath = path.join(this.checkpointDir, 'checkpoint.json');
  }

  static async create(options: CreateCheckpointOptions): Promise<CheckpointManager> {
    const checkpointDir = options.checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const jobDir = path.join(checkpointDir, options.jobId);

    await fs.promises.mkdir(jobDir, { recursive: true });

    const totalChunks = Math.ceil(options.totalRows / options.chunkSize);
    const chunks: ChunkMetadata[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const startRow = i * options.chunkSize + 1;
      const endRow = Math.min((i + 1) * options.chunkSize, options.totalRows);
      chunks.push({
        chunkId: i,
        startRow,
        endRow,
        status: 'pending',
        successes: 0,
        failures: 0,
        membershipsCreated: 0,
        usersCreated: 0,
        duplicateUsers: 0,
        duplicateMemberships: 0,
      });
    }

    const now = Date.now();
    const state: CheckpointState = {
      jobId: options.jobId,
      csvPath: options.csvPath,
      csvHash: options.csvHash,
      createdAt: now,
      updatedAt: now,
      chunkSize: options.chunkSize,
      concurrency: options.concurrency,
      totalRows: options.totalRows,
      chunks,
      summary: {
        total: 0,
        successes: 0,
        failures: 0,
        membershipsCreated: 0,
        usersCreated: 0,
        duplicateUsers: 0,
        duplicateMemberships: 0,
        startedAt: now,
        endedAt: null,
        warnings: [],
      },
      mode: options.mode,
      orgId: options.orgId,
    };

    const manager = new CheckpointManager(options.jobId, state, checkpointDir);
    await manager.saveCheckpoint();
    return manager;
  }

  static async resume(jobId: string, checkpointDir?: string): Promise<CheckpointManager> {
    const dir = checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const checkpointPath = path.join(dir, jobId, 'checkpoint.json');

    if (!fs.existsSync(checkpointPath)) {
      throw new Error(`Checkpoint not found for job: ${jobId} at ${checkpointPath}`);
    }

    const data = await fs.promises.readFile(checkpointPath, 'utf8');
    const state: CheckpointState = JSON.parse(data);
    return new CheckpointManager(jobId, state, dir);
  }

  static async exists(jobId: string, checkpointDir?: string): Promise<boolean> {
    const dir = checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const checkpointPath = path.join(dir, jobId, 'checkpoint.json');
    return fs.existsSync(checkpointPath);
  }

  async saveCheckpoint(): Promise<void> {
    this.state.updatedAt = Date.now();
    await fs.promises.mkdir(this.checkpointDir, { recursive: true });

    const tempPath = `${this.checkpointPath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.promises.rename(tempPath, this.checkpointPath);
  }

  getState(): Readonly<CheckpointState> {
    return this.state;
  }

  getJobId(): string {
    return this.jobId;
  }

  getCheckpointDir(): string {
    return this.checkpointDir;
  }

  getNextPendingChunk(): ChunkMetadata | null {
    return this.state.chunks.find((c) => c.status === 'pending') || null;
  }

  markChunkStarted(chunkId: number): void {
    const chunk = this.state.chunks[chunkId];
    if (!chunk) throw new Error(`Invalid chunk ID: ${chunkId}`);
    chunk.startedAt = Date.now();
  }

  markChunkCompleted(chunkId: number, chunkSummary: ChunkSummary): void {
    const chunk = this.state.chunks[chunkId];
    if (!chunk) throw new Error(`Invalid chunk ID: ${chunkId}`);

    chunk.status = 'completed';
    chunk.completedAt = Date.now();
    chunk.durationMs = chunkSummary.durationMs;
    chunk.successes = chunkSummary.successes;
    chunk.failures = chunkSummary.failures;
    chunk.membershipsCreated = chunkSummary.membershipsCreated;
    chunk.usersCreated = chunkSummary.usersCreated;
    chunk.duplicateUsers = chunkSummary.duplicateUsers;
    chunk.duplicateMemberships = chunkSummary.duplicateMemberships;
    chunk.rolesAssigned = chunkSummary.rolesAssigned;

    this.updateSummary(chunkSummary);
  }

  markChunkFailed(chunkId: number): void {
    const chunk = this.state.chunks[chunkId];
    if (!chunk) throw new Error(`Invalid chunk ID: ${chunkId}`);
    chunk.status = 'failed';
  }

  private updateSummary(chunkSummary: ChunkSummary): void {
    this.state.summary.total += chunkSummary.successes + chunkSummary.failures;
    this.state.summary.successes += chunkSummary.successes;
    this.state.summary.failures += chunkSummary.failures;
    this.state.summary.membershipsCreated += chunkSummary.membershipsCreated;
    this.state.summary.usersCreated += chunkSummary.usersCreated;
    this.state.summary.duplicateUsers += chunkSummary.duplicateUsers;
    this.state.summary.duplicateMemberships += chunkSummary.duplicateMemberships;
    this.state.summary.rolesAssigned =
      (this.state.summary.rolesAssigned ?? 0) + (chunkSummary.rolesAssigned ?? 0);
    if (chunkSummary.warnings?.length) {
      this.state.summary.warnings.push(...chunkSummary.warnings);
    }
  }

  getFinalSummary(): ImportSummary {
    const progress = this.getProgress();
    return {
      totalRows: this.state.summary.total,
      usersCreated: this.state.summary.usersCreated,
      membershipsCreated: this.state.summary.membershipsCreated,
      duplicateUsers: this.state.summary.duplicateUsers,
      duplicateMemberships: this.state.summary.duplicateMemberships,
      errors: this.state.summary.failures,
      rolesAssigned: this.state.summary.rolesAssigned ?? 0,
      roleAssignmentFailures: this.state.summary.roleAssignmentFailures ?? 0,
      warnings: this.state.summary.warnings,
      duration: Date.now() - this.state.summary.startedAt,
      chunkProgress: {
        completedChunks: progress.completedChunks,
        totalChunks: progress.totalChunks,
        percentComplete: progress.percentComplete,
      },
      cacheStats: this.state.orgCache
        ? {
            hits: this.state.orgCache.stats.hits,
            misses: this.state.orgCache.stats.misses,
            hitRate: `${calculateHitRate(this.state.orgCache.stats.hits, this.state.orgCache.stats.misses)}%`,
          }
        : undefined,
    };
  }

  getProgress(): {
    completedChunks: number;
    totalChunks: number;
    percentComplete: number;
    estimatedTimeRemainingMs: number | null;
  } {
    const completedChunks = this.state.chunks.filter((c) => c.status === 'completed').length;
    const totalChunks = this.state.chunks.length;
    const percentComplete = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0;

    const completedWithTime = this.state.chunks
      .filter((c) => c.status === 'completed' && c.durationMs)
      .slice(-5);

    const avgChunkMs =
      completedWithTime.length > 0
        ? completedWithTime.reduce((sum, c) => sum + (c.durationMs || 0), 0) /
          completedWithTime.length
        : null;

    const remaining = totalChunks - completedChunks;
    const estimatedTimeRemainingMs = avgChunkMs && remaining > 0 ? avgChunkMs * remaining : null;

    return { completedChunks, totalChunks, percentComplete, estimatedTimeRemainingMs };
  }

  serializeCache(cache: OrgCache): void {
    const entries = cache.serialize();
    const stats = cache.getStats();
    this.state.orgCache = {
      entries,
      stats: { hits: stats.hits, misses: stats.misses, evictions: stats.evictions },
    };
  }

  restoreCache(
    workos: import('@workos-inc/node').WorkOS | null,
    dryRun?: boolean,
  ): OrgCache | null {
    if (!this.state.orgCache) return null;
    return OrgCache.deserialize(workos, this.state.orgCache.entries, { maxSize: 10000, dryRun });
  }

  async deleteCheckpoint(): Promise<void> {
    await fs.promises.rm(this.checkpointDir, { recursive: true, force: true });
  }
}

function calculateHitRate(hits: number, misses: number): string {
  const total = hits + misses;
  if (total === 0) return '0.0';
  return ((hits / total) * 100).toFixed(1);
}

export async function calculateCsvHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export async function findLastJob(checkpointDir?: string): Promise<string | null> {
  const dir = checkpointDir || DEFAULT_CHECKPOINT_DIR;
  if (!fs.existsSync(dir)) return null;

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const jobDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (jobDirs.length === 0) return null;

  let latestJob: string | null = null;
  let latestTime = 0;

  for (const jobId of jobDirs) {
    const checkpointPath = path.join(dir, jobId, 'checkpoint.json');
    if (fs.existsSync(checkpointPath)) {
      const stats = await fs.promises.stat(checkpointPath);
      if (stats.mtimeMs > latestTime) {
        latestTime = stats.mtimeMs;
        latestJob = jobId;
      }
    }
  }

  return latestJob;
}
