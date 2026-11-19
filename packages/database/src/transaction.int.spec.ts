// Integração com Postgres real: timeouts, tradução de erros, unidade de trabalho e tipos.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { ResourceBusyError, PgErrorCode, pgErrorCode } from './errors';
import { createTestDatabase, type TestDatabase } from './testing';
import { Database, withTransaction } from './transaction';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await db.pool.query(
    "INSERT INTO accounts (id, holder_name, document, balance_cents) VALUES ('0193a1b2-7c4d-7e5f-8a6b-000000000001', 'A', '52998224725', 9007199254740993)",
  );
});

afterAll(async () => {
  await db.drop();
});

const ACCOUNT = '0193a1b2-7c4d-7e5f-8a6b-000000000001';

describe('pool', () => {
  it('[PERF-09] int8 vira bigint, sem perder precisão acima de 2^53', async () => {
    const { rows } = await db.pool.query<{ balance_cents: bigint; n: bigint }>(
      'SELECT balance_cents, count(*) OVER () AS n FROM accounts WHERE id = $1',
      [ACCOUNT],
    );
    expect(rows[0]?.balance_cents).toBe(9007199254740993n);
    expect(rows[0]?.n).toBe(1n);
  });

  it('[PERF-06] sessões têm idle_in_transaction_session_timeout de 10 s', async () => {
    const { rows } = await db.pool.query<{ v: string }>('SELECT current_setting($1) AS v', [
      'idle_in_transaction_session_timeout',
    ]);
    expect(rows[0]?.v).toBe('10s');
  });
});

describe('withTransaction', () => {
  it('[PERF-06] aplica lock_timeout 2 s e statement_timeout 5 s só dentro da transação', async () => {
    const inside = await withTransaction(db.pool, async (client) => {
      const { rows } = await client.query<{ l: string; s: string }>(
        "SELECT current_setting('lock_timeout') AS l, current_setting('statement_timeout') AS s",
      );
      return rows[0];
    });
    expect(inside).toEqual({ l: '2s', s: '5s' });

    const { rows } = await db.pool.query<{ l: string }>(
      "SELECT current_setting('lock_timeout') AS l",
    );
    expect(rows[0]?.l).toBe('0');
  });

  it('faz commit no sucesso e rollback em erro', async () => {
    await expect(
      withTransaction(db.pool, async (client) => {
        await client.query('UPDATE accounts SET holder_name = $1 WHERE id = $2', ['B', ACCOUNT]);
        throw new Error('falha simulada');
      }),
    ).rejects.toThrow('falha simulada');
    let { rows } = await db.pool.query<{ holder_name: string }>(
      'SELECT holder_name FROM accounts WHERE id = $1',
      [ACCOUNT],
    );
    expect(rows[0]?.holder_name).toBe('A');

    await withTransaction(db.pool, async (client) => {
      await client.query('UPDATE accounts SET holder_name = $1 WHERE id = $2', ['C', ACCOUNT]);
    });
    ({ rows } = await db.pool.query('SELECT holder_name FROM accounts WHERE id = $1', [ACCOUNT]));
    expect(rows[0]?.holder_name).toBe('C');
  });

  it('[PERF-06] lock disputado além do lock_timeout vira ResourceBusyError, rápido', async () => {
    let releaseHolder!: () => void;
    const holderReady = new Promise<void>((ready) => {
      void withTransaction(db.pool, async (client) => {
        await client.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [ACCOUNT]);
        ready();
        await new Promise<void>((r) => (releaseHolder = r));
      });
    });
    await holderReady;

    const startedAt = Date.now();
    const attempt = withTransaction(
      db.pool,
      (client) => client.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [ACCOUNT]),
      { lockTimeoutMs: 150 },
    );
    await expect(attempt).rejects.toBeInstanceOf(ResourceBusyError);
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    releaseHolder();
  });

  it('[PERF-06] statement acima do statement_timeout é cancelado (57014), não vira ResourceBusy', async () => {
    const error: unknown = await withTransaction(
      db.pool,
      (client) => client.query('SELECT pg_sleep(1)'),
      { statementTimeoutMs: 100 },
    ).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ResourceBusyError);
    expect(pgErrorCode(error)).toBe(PgErrorCode.queryCanceled);
  });
});

describe('Database (unidade de trabalho via AsyncLocalStorage)', () => {
  it('query() dentro de transaction() usa a mesma conexão; aninhadas participam da externa', async () => {
    const database = new Database(db.pool);
    const pids = await database.transaction(async () => {
      const outer = await database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const inner = await database.transaction(() =>
        database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'),
      );
      return [outer.rows[0]?.pid, inner.rows[0]?.pid, database.inTransaction];
    });
    expect(pids[0]).toBe(pids[1]);
    expect(pids[2]).toBe(true);
    expect(database.inTransaction).toBe(false);
  });

  it('erro em qualquer ponto desfaz tudo que foi feito via query()', async () => {
    const database = new Database(db.pool);
    await expect(
      database.transaction(async () => {
        await database.query('UPDATE accounts SET holder_name = $1 WHERE id = $2', ['X', ACCOUNT]);
        await database.query('UPDATE accounts SET balance_cents = -1 WHERE id = $1', [ACCOUNT]);
      }),
    ).rejects.toMatchObject({ code: PgErrorCode.checkViolation });
    const { rows } = await database.query<{ holder_name: string }>(
      'SELECT holder_name FROM accounts WHERE id = $1',
      [ACCOUNT],
    );
    expect(rows[0]?.holder_name).not.toBe('X');
  });

  it('transações concorrentes não enxergam o client uma da outra', async () => {
    const database = new Database(db.pool);
    const pids = await Promise.all(
      [1, 2, 3].map(() =>
        database.transaction(async () => {
          await new Promise((r) => setTimeout(r, 20));
          const { rows } = await database.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          return rows[0]?.pid;
        }),
      ),
    );
    expect(new Set(pids).size).toBe(3);
  });
});
