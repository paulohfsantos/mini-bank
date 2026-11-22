// Migrations na AWS (task `mini-banco-lab-migrate`, ADR-0026): roda de dentro da VPC, porque
// o RDS fica em subnets isoladas. Dois passos, com a senha master do RDS:
//   1. `dbmate up` com as mesmas migrations do local e dos testes (ADR-0019);
//   2. LOGIN + senha dos papéis de aplicação, lidas do Secrets Manager. A migration 0002 cria
//      os papéis sem LOGIN e sem senha: senha nunca entra no git (local: postgres-init.sql).
import { spawn } from 'node:child_process';
import type { Pool } from '@mini-banco/database';

/** Whitelist: o nome do papel vira identificador SQL (SEC-09). */
export const APP_ROLES = ['mini_banco_api', 'mini_banco_worker'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export interface MigrationTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: 'disable' | 'verify-full';
  caFile?: string;
}

/**
 * URL do dbmate (lib/pq). Usuário e senha codificados: a senha gerada pelo RDS pode ter
 * `@`, `:`, `/`, `#`. Em verify-full, o lib/pq valida cadeia e hostname com o `sslrootcert`.
 */
export function dbmateUrl(t: MigrationTarget): string {
  const url = new URL('postgres://placeholder');
  url.username = encodeURIComponent(t.user);
  url.password = encodeURIComponent(t.password);
  url.hostname = t.host;
  url.port = String(t.port);
  url.pathname = `/${encodeURIComponent(t.database)}`;
  url.searchParams.set('sslmode', t.ssl);
  if (t.ssl === 'verify-full') {
    if (!t.caFile) throw new Error('verify-full exige o CA bundle (DB_SSL_CA_FILE)');
    url.searchParams.set('sslrootcert', t.caFile);
  }
  return url.toString();
}

/**
 * Roda o dbmate com a URL no ambiente (DATABASE_URL), não na linha de comando: argumentos
 * aparecem em `ps` e em logs de processo. Saída do dbmate vai direto para o log da task.
 */
export function runDbmate(options: {
  bin: string;
  url: string;
  migrationsDir: string;
}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      options.bin,
      ['--migrations-dir', options.migrationsDir, '--no-dump-schema', 'up'],
      {
        env: { PATH: process.env.PATH, DATABASE_URL: options.url },
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`dbmate terminou com ${signal ?? `código ${String(code)}`}`));
    });
  });
}

/**
 * `ALTER ROLE ... PASSWORD` é comando utilitário e não aceita parâmetros (`$1`). Para não montar
 * SQL com o valor (SEC-09), uma função temporária da sessão (`pg_temp`, some no fim da conexão)
 * recebe papel e senha como parâmetros e monta o comando com `format('%I', '%L')` no servidor.
 * O papel ainda vem da whitelist. Idempotente: rodar de novo só reaplica a senha atual.
 */
const SET_ROLE_PASSWORD_FN = `
  CREATE OR REPLACE FUNCTION pg_temp.set_login_password(role_name text, secret text) RETURNS void
  LANGUAGE plpgsql AS $fn$
  BEGIN
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', role_name, secret);
  END
  $fn$`;

export async function setAppRolePasswords(
  pool: Pool,
  passwords: Record<AppRole, string>,
): Promise<void> {
  for (const role of APP_ROLES) {
    if (passwords[role].length < 16) throw new Error(`senha curta demais para ${role}`);
  }
  const client = await pool.connect();
  try {
    await client.query(SET_ROLE_PASSWORD_FN);
    for (const role of APP_ROLES) {
      await client.query('SELECT pg_temp.set_login_password($1, $2)', [role, passwords[role]]);
    }
  } finally {
    // A conexão volta ao pool com a função temporária; o pool desta task tem uma conexão só
    // e é encerrado em seguida.
    client.release();
  }
}
