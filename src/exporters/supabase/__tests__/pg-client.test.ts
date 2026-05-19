import { jest } from '@jest/globals';
import type { PoolConfig } from 'pg';
import { SupabasePgClient, type PgPoolLike } from '../pg-client.js';
import { SupabasePgError } from '../types.js';

interface FakePool extends PgPoolLike {
  config: PoolConfig;
  queries: Array<{ sql: string; params?: unknown[] }>;
  closed: boolean;
}

function createFakePoolFactory(queryImpl?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>): {
  factory: (config: PoolConfig) => PgPoolLike;
  pools: FakePool[];
} {
  const pools: FakePool[] = [];
  const factory = (config: PoolConfig): PgPoolLike => {
    const pool: FakePool = {
      config,
      queries: [],
      closed: false,
      async query(sql: string, params?: unknown[]) {
        pool.queries.push({ sql, params });
        if (queryImpl) return queryImpl(sql, params);
        return { rows: [] };
      },
      async end() {
        pool.closed = true;
      },
    };
    pools.push(pool);
    return pool;
  };
  return { factory, pools };
}

describe('SupabasePgClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes connectionString, max: 1, and statement_timeout to the pool factory', () => {
    const { factory, pools } = createFakePoolFactory();
    new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:5432/postgres',
      statementTimeoutMs: 12_000,
      poolFactory: factory,
    });

    expect(pools).toHaveLength(1);
    expect(pools[0].config.max).toBe(1);
    expect(pools[0].config.statement_timeout).toBe(12_000);
    expect(pools[0].config.connectionString).toBe('postgresql://user:pw@db.example.com:5432/postgres');
  });

  it('uses a 30s default statement timeout when not specified', () => {
    const { factory, pools } = createFakePoolFactory();
    new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:5432/postgres',
      poolFactory: factory,
    });
    expect(pools[0].config.statement_timeout).toBe(30_000);
  });

  it('exposes a pooler warning when the connection string targets port 6543', () => {
    const { factory } = createFakePoolFactory();
    const client = new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:6543/postgres',
      poolFactory: factory,
    });
    expect(client.poolerWarning).toMatch(/PgBouncer/);
  });

  it('returns undefined poolerWarning for direct (5432) connections', () => {
    const { factory } = createFakePoolFactory();
    const client = new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:5432/postgres',
      poolFactory: factory,
    });
    expect(client.poolerWarning).toBeUndefined();
  });

  it('runs SELECT 1 in testConnection() and surfaces a SupabasePgError with hint on failure', async () => {
    const { factory } = createFakePoolFactory(async () => {
      throw new Error('SSL connection required');
    });
    const client = new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:5432/postgres',
      poolFactory: factory,
    });

    let caught: unknown;
    try {
      await client.testConnection();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SupabasePgError);
    expect((caught as SupabasePgError).hint).toMatch(/sslmode=require/);
  });

  it('forwards query() params to the pool and returns rows', async () => {
    const { factory, pools } = createFakePoolFactory(async (_sql, params) => ({
      rows: [{ email: 'a@example.com', encrypted_password: '$2b$10$abc' }],
      lastParams: params,
    } as unknown as { rows: unknown[] }));
    const client = new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:5432/postgres',
      poolFactory: factory,
    });

    const rows = await client.query<{ email: string }>('SELECT 1 WHERE x = ANY($1)', [['a@example.com']]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('a@example.com');
    expect(pools[0].queries[0].params).toEqual([['a@example.com']]);
  });

  it('close() ends the underlying pool', async () => {
    const { factory, pools } = createFakePoolFactory();
    const client = new SupabasePgClient({
      connectionString: 'postgresql://user:pw@db.example.com:5432/postgres',
      poolFactory: factory,
    });
    await client.close();
    expect(pools[0].closed).toBe(true);
  });
});
