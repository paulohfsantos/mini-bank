import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPool } from './pool';
import { createTestDatabase, type TestDatabase } from './testing';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
});

afterAll(async () => {
  await db.drop();
});

describe('createPool', () => {
  it('conexão ociosa encerrada pelo servidor não derruba o processo; o pool se recupera', async () => {
    const url = new URL(db.url);
    const errors: Error[] = [];
    const pool = createPool({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      applicationName: 'idle-error-test',
      max: 2,
      onIdleError: (error) => errors.push(error),
    });
    try {
      await pool.query('SELECT 1'); // deixa uma conexão ociosa no pool

      // Simula restart/failover: o servidor encerra a sessão ociosa.
      await db.pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE application_name = 'idle-error-test'`,
      );
      await new Promise((r) => setTimeout(r, 200));

      expect(errors.length).toBeGreaterThan(0);
      const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
