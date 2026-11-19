// Postgres real para testes de integração e e2e (PERF-26):
// - UM container por execução (globalSetup), com as migrations aplicadas UMA vez num
//   banco-modelo pelo próprio dbmate (mesmo caminho da produção);
// - cada arquivo de teste ganha um banco novo via CREATE DATABASE ... TEMPLATE
//   (cópia em dezenas de ms), então testes não compartilham estado.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { createPool } from '../pool';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../../..');
/** Mesma imagem do docker-compose (e versão principal do RDS). */
const IMAGE = 'postgres:17.12-alpine';
const TEMPLATE_DB = 'minibanco_template';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export interface StartedTestPostgres {
  /** URL do banco `postgres` (administração), com o superusuário do container. */
  adminUrl: string;
  stop: () => Promise<void>;
}

export async function startTestPostgres(): Promise<StartedTestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGE)
    .withDatabase('postgres')
    // Testes não precisam de durabilidade: fsync desligado deixa o CREATE DATABASE e os
    // commits bem mais rápidos. Nunca fora de teste.
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ])
    .start();
  const adminUrl = container.getConnectionUri();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const createTemplateSql = `CREATE DATABASE ${TEMPLATE_DB}`; // constante deste arquivo
    await admin.query(createTemplateSql);
  } finally {
    await admin.end();
  }

  await exec(
    'pnpm',
    [
      'exec',
      'dbmate',
      '--url',
      `${urlFor(adminUrl, TEMPLATE_DB)}?sslmode=disable`,
      '--migrations-dir',
      'db/migrations',
      '--no-dump-schema',
      'up',
    ],
    { cwd: ROOT },
  );

  return { adminUrl, stop: async () => void (await container.stop()) };
}

export interface TestDatabase {
  name: string;
  url: string;
  pool: pg.Pool;
  /** Fecha o pool e apaga o banco. */
  drop: () => Promise<void>;
}

/** Banco novo, já migrado, copiado do modelo. */
export async function createTestDatabase(
  adminUrl: string,
  options: { max?: number; role?: string } = {},
): Promise<TestDatabase> {
  // Identificador gerado aqui (hex), nunca vindo de entrada externa (SEC-09).
  const name = `t_${randomBytes(8).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const createSql = `CREATE DATABASE ${admin.escapeIdentifier(name)} TEMPLATE ${TEMPLATE_DB}`;
    await admin.query(createSql);
  } finally {
    await admin.end();
  }

  const url = urlFor(adminUrl, name);
  const pool = createPool({
    connectionString: url,
    applicationName: 'test',
    max: options.max ?? 10,
    ...(options.role ? { role: options.role } : {}),
  });

  return {
    name,
    url,
    pool,
    drop: async () => {
      await pool.end();
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      try {
        const dropSql = `DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`;
        await client.query(dropSql);
      } finally {
        await client.end();
      }
    },
  };
}
