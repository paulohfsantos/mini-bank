// Integração da task de migration (ADR-0026) contra o Postgres real: dbmate num banco vazio
// e LOGIN dos papéis de aplicação com a senha que viria do Secrets Manager.
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createPool } from '@mini-banco/database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { dbmateUrl, runDbmate, setAppRolePasswords } from '../../src/ops/migrate';

const ROOT = resolve(import.meta.dirname, '../../../..');
const name = `migrate_${randomBytes(4).toString('hex')}`;
let pool: pg.Pool;
let base: URL;

/** Conexão de administração curta: nada fica aberto no banco `postgres` entre os testes. */
async function asAdmin(sql: string): Promise<void> {
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  try {
    await admin.query(sql);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  base = new URL(inject('pgAdminUrl'));
  const createSql = `CREATE DATABASE ${name}`; // nome gerado neste arquivo
  await asAdmin(createSql);
  // createPool registra o listener de 'error': uma conexão ociosa encerrada pelo servidor
  // (DROP ... WITH (FORCE), parada do container) não vira erro não tratado. Sem ele o CI
  // falhou de forma intermitente com 57P01 vindo deste arquivo.
  pool = createPool({
    connectionString: Object.assign(new URL(base), { pathname: `/${name}` }).toString(),
    applicationName: 'migrate-test',
    max: 1,
  });
});

afterAll(async () => {
  await pool.end();
  const dropSql = `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`;
  await asAdmin(dropSql);
});

describe('task de migration', () => {
  it('aplica as migrations num banco vazio e libera o LOGIN dos papéis de aplicação', async () => {
    const target = {
      host: base.hostname,
      port: Number(base.port),
      database: name,
      user: decodeURIComponent(base.username),
      password: decodeURIComponent(base.password),
      ssl: 'disable' as const,
    };
    await runDbmate({
      bin: resolve(ROOT, 'node_modules/.bin/dbmate'),
      url: dbmateUrl(target),
      migrationsDir: resolve(ROOT, 'db/migrations'),
    });
    const apiPassword = `api-${randomBytes(12).toString('hex')}'; DROP TABLE accounts; --`;
    const workerPassword = `wk-${randomBytes(12).toString('hex')}`;
    await setAppRolePasswords(pool, {
      mini_banco_api: apiPassword,
      mini_banco_worker: workerPassword,
    });

    const asApi = new pg.Client({
      host: base.hostname,
      port: Number(base.port),
      database: name,
      user: 'mini_banco_api',
      password: apiPassword,
    });
    await asApi.connect();
    try {
      // Aspa na senha não virou SQL: a tabela existe e o papel só tem o DML da 0002.
      const { rows } = await asApi.query<{ n: string }>('SELECT count(*) AS n FROM accounts');
      expect(rows[0]?.n).toBe('0');
      await expect(asApi.query('SELECT 1 FROM fraud_reviews')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await asApi.end();
    }

    // Rodar de novo é seguro (deploys repetem a task).
    await runDbmate({
      bin: resolve(ROOT, 'node_modules/.bin/dbmate'),
      url: dbmateUrl(target),
      migrationsDir: resolve(ROOT, 'db/migrations'),
    });
    await setAppRolePasswords(pool, {
      mini_banco_api: apiPassword,
      mini_banco_worker: workerPassword,
    });
  });

  it('senha curta é recusada antes de chegar ao banco', async () => {
    await expect(
      setAppRolePasswords(pool, { mini_banco_api: 'curta', mini_banco_worker: 'x'.repeat(20) }),
    ).rejects.toThrow(/curta/);
  });
});
