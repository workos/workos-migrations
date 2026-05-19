import { Pool, type PoolConfig } from 'pg';
import { SupabasePgError } from './types.js';

export interface SupabasePgClientOptions {
  connectionString: string;
  statementTimeoutMs?: number;
  /**
   * Inject a custom pool factory. Used by tests to swap in a fake.
   * Production code should leave this unset.
   */
  poolFactory?: (config: PoolConfig) => PgPoolLike;
}

/** Minimal subset of `pg.Pool` we use; mirrored for testability. */
export interface PgPoolLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/**
 * Subset of {@link SupabasePgClient} that downstream mappers and the password
 * merger consume. Tests pass a fake implementing this interface; production
 * passes the concrete {@link SupabasePgClient}.
 */
export interface SupabasePgQueryClient {
  testConnection(): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
  poolerWarning?: string;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

function resolveStatementTimeout(explicit: number | undefined): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) return explicit;
  const fromEnv = process.env.SUPABASE_PG_STATEMENT_TIMEOUT_MS;
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_STATEMENT_TIMEOUT_MS;
}

function detectPoolerWarning(connectionString: string): string | undefined {
  // Supabase's transaction pooler (PgBouncer) listens on 6543; direct on 5432.
  // PgBouncer in transaction mode breaks prepared statements.
  if (/:6543\b/.test(connectionString)) {
    return 'Connection string uses port 6543 (PgBouncer pooler). Prepared statements may fail; consider the direct connection on port 5432 for migrations.';
  }
  return undefined;
}

export class SupabasePgClient {
  private readonly pool: PgPoolLike;
  private readonly statementTimeoutMs: number;
  public readonly poolerWarning?: string;

  constructor(options: SupabasePgClientOptions) {
    this.statementTimeoutMs = resolveStatementTimeout(options.statementTimeoutMs);
    this.poolerWarning = detectPoolerWarning(options.connectionString);

    const factory =
      options.poolFactory ??
      ((config: PoolConfig): PgPoolLike => new Pool(config) as unknown as PgPoolLike);

    this.pool = factory({
      connectionString: options.connectionString,
      max: 1,
      statement_timeout: this.statementTimeoutMs,
    });
  }

  async testConnection(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch (error: unknown) {
      const message = (error as Error).message ?? 'unknown error';
      throw new SupabasePgError(
        `Supabase Postgres connection failed: ${message}`,
        'Confirm the connection string includes ?sslmode=require and uses the direct connection (port 5432, not the pooler on 6543).',
      );
    }
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
