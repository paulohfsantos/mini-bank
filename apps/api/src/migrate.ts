// Entrada da task de migration (ADR-0026): `node dist/migrate.js` na imagem da api.
// Código de saída 0 = migrado; o CI (fase 7) espera o exitCode da task.
import { resolve } from 'node:path';
import { createPool, dbTlsOptions } from '@mini-banco/database';
import { createLogger } from '@mini-banco/observability';
import { z } from 'zod';
import { dbmateUrl, runDbmate, setAppRolePasswords } from './ops/migrate';

const EnvSchema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().min(1),
  DB_SSL: z.enum(['disable', 'verify-full']).default('verify-full'),
  DB_SSL_CA_FILE: z.string().min(1).optional(),
  /** Do secret master gerenciado pelo RDS (chaves `username`/`password`). */
  MASTER_DB_USER: z.string().min(1),
  MASTER_DB_PASSWORD: z.string().min(1),
  API_DB_PASSWORD: z.string().min(16),
  WORKER_DB_PASSWORD: z.string().min(16),
  DBMATE_BIN: z.string().min(1).default('dbmate'),
  MIGRATIONS_DIR: z
    .string()
    .min(1)
    .default(resolve(import.meta.dirname, '../../../db/migrations')),
});

const logger = createLogger({ service: 'migrate' });

async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Só nomes de variáveis, nunca valores (são segredos).
    throw new Error(
      `configuração inválida: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  const e = parsed.data;
  const target = {
    host: e.DB_HOST,
    port: e.DB_PORT,
    database: e.DB_NAME,
    user: e.MASTER_DB_USER,
    password: e.MASTER_DB_PASSWORD,
    ssl: e.DB_SSL,
    ...(e.DB_SSL_CA_FILE ? { caFile: e.DB_SSL_CA_FILE } : {}),
  };

  logger.info({ migrationsDir: e.MIGRATIONS_DIR }, 'running migrations');
  await runDbmate({ bin: e.DBMATE_BIN, url: dbmateUrl(target), migrationsDir: e.MIGRATIONS_DIR });

  const pool = createPool({
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
    ssl: dbTlsOptions(e.DB_SSL, e.DB_SSL_CA_FILE),
    applicationName: 'migrate',
    max: 1,
  });
  try {
    await setAppRolePasswords(pool, {
      mini_banco_api: e.API_DB_PASSWORD,
      mini_banco_worker: e.WORKER_DB_PASSWORD,
    });
  } finally {
    await pool.end();
  }
  logger.info('migrations applied; app roles can log in');
}

try {
  await main();
} catch (error) {
  logger.error(
    { err: { message: error instanceof Error ? error.message : String(error) } },
    'migration failed',
  );
  process.exitCode = 1;
}
