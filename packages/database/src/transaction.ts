// Transações com timeouts obrigatórios (PERF-06, TRF-BR-06).
import { AsyncLocalStorage } from 'node:async_hooks';
import type pg from 'pg';
import { translatePgError } from './errors';

export interface TransactionOptions {
  /** Espera máxima por um lock antes de falhar com 55P03. Padrão 2 s. */
  lockTimeoutMs?: number;
  /** Duração máxima de cada statement. Padrão 5 s. */
  statementTimeoutMs?: number;
}

const DEFAULTS = {
  lockTimeoutMs: 2_000,
  statementTimeoutMs: 5_000,
} satisfies Required<TransactionOptions>;

/**
 * BEGIN → timeouts locais → fn → COMMIT; qualquer erro faz ROLLBACK e é traduzido
 * (55P03 → ResourceBusyError). Isolamento Read Committed (padrão) com locks explícitos.
 * Os timeouts usam set_config(..., true), equivalente a SET LOCAL, mas parametrizado.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const { lockTimeoutMs, statementTimeoutMs } = { ...DEFAULTS, ...options };
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('lock_timeout', $1, true), set_config('statement_timeout', $2, true)",
      [`${lockTimeoutMs}ms`, `${statementTimeoutMs}ms`],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // Conexão em estado desconhecido: devolve ao pool como quebrada para ser descartada.
      releaseError =
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw translatePgError(error);
  } finally {
    client.release(releaseError);
  }
}

/**
 * Executor de queries com unidade de trabalho via AsyncLocalStorage (ADR-0004):
 * dentro de `transaction()`, `query()` usa o client da transação atual; fora, o pool.
 * Repositórios recebem esta instância e não precisam saber se estão numa transação.
 */
export class Database {
  private readonly current = new AsyncLocalStorage<pg.PoolClient>();

  constructor(
    readonly pool: pg.Pool,
    private readonly txOptions: TransactionOptions = {},
  ) {}

  /** Chamadas aninhadas participam da transação externa (não abrem savepoint). */
  transaction<T>(fn: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    if (this.current.getStore()) return fn();
    return withTransaction(this.pool, (client) => this.current.run(client, fn), {
      ...this.txOptions,
      ...options,
    });
  }

  get inTransaction(): boolean {
    return this.current.getStore() !== undefined;
  }

  /** Sempre parametrizada: `text` com $1, $2…, valores em `values` (SEC-09). */
  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<R>> {
    const executor = this.current.getStore() ?? this.pool;
    try {
      return await executor.query<R>(text, values as unknown[] | undefined);
    } catch (error) {
      throw translatePgError(error);
    }
  }
}
