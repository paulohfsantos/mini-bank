// Pool do pg com os limites do projeto (PERF-02, PERF-06).
import pg from 'pg';

type TextParserFn = (value: string) => unknown;

/**
 * `int8`/`bigint` (OID 20) vira `bigint` em vez de string (padrão do pg, que evita perder
 * precisão). Configurado por pool, sem alterar o `pg.types` global do processo.
 */
const PARSERS: Partial<Record<number, TextParserFn>> = {
  [pg.types.builtins.INT8]: (value) => BigInt(value),
};

function getTypeParser(oid: number, format: 'text' | 'binary' = 'text'): TextParserFn {
  // O pg tipa o parser padrão como `any`; aqui ele é tratado como string → unknown.
  const fallback = pg.types.getTypeParser(oid, format) as TextParserFn;
  return PARSERS[oid] ?? fallback;
}

export const customTypes: pg.CustomTypesConfig = { getTypeParser };

export interface CreatePoolOptions {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Identifica o processo em pg_stat_activity (`api`, `worker`). */
  applicationName: string;
  /** Tamanho do pool. Orçamento: api 10 + worker 5 por task, contra max_connections do RDS (PERF-02). */
  max: number;
  /** TLS (na AWS: verify-full com o CA do RDS). Local: desligado. */
  ssl?: pg.PoolConfig['ssl'];
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  /** Mata sessões esquecidas "idle in transaction" (segurando locks). Padrão 10 s. */
  idleInTransactionTimeoutMillis?: number;
  /**
   * Papel assumido no início da sessão (`SET ROLE`). Usado nos testes para rodar como
   * `mini_banco_api` mesmo conectando com o superusuário do container.
   */
  role?: string;
  /**
   * Erro numa conexão ociosa (Postgres reiniciou, failover do RDS, sessão encerrada).
   * O pool já descarta a conexão; aqui só se registra. Sem listener, o `pg.Pool` emite
   * 'error' sem ouvinte e o Node derruba o processo.
   */
  onIdleError?: (error: Error) => void;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function createPool(options: CreatePoolOptions): pg.Pool {
  const {
    applicationName,
    idleInTransactionTimeoutMillis = 10_000,
    connectionTimeoutMillis = 3_000,
    idleTimeoutMillis = 10_000,
    role,
    onIdleError = () => undefined,
    ...connection
  } = options;

  // Parâmetros de sessão aplicados no handshake, sem query extra por conexão.
  const sessionOptions = [
    `-c idle_in_transaction_session_timeout=${idleInTransactionTimeoutMillis}`,
  ];
  if (role !== undefined) {
    // Vai para a string de opções da conexão: só nomes simples (whitelist, SEC-09).
    if (!ROLE_NAME.test(role)) throw new Error(`nome de papel inválido: ${role}`);
    sessionOptions.push(`-c role=${role}`);
  }

  const pool = new pg.Pool({
    ...connection,
    application_name: applicationName,
    connectionTimeoutMillis,
    idleTimeoutMillis,
    options: sessionOptions.join(' '),
    types: customTypes,
  });
  pool.on('error', onIdleError);
  return pool;
}
