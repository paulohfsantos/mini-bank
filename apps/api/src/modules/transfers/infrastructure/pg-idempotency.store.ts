import { type Transfer as TransferResponse, TransferSchema } from '@mini-banco/contracts';
import { type Database, ResourceBusyError } from '@mini-banco/database';
import { RequestInProgressError } from '../../../shared/domain/errors';
import type { IdempotencyAcquireResult, IdempotencyStore } from '../application/ports';

interface KeyRow {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

/**
 * ADR-0008. O INSERT da chave é o primeiro statement da transação:
 * - chave nova → a linha fica travada (não commitada) até o fim da transação;
 * - outra transação com a mesma chave → o INSERT espera no índice único até a primeira
 *   terminar; se passar do lock_timeout, 55P03 → RequestInProgressError (409, TRF-AC-13);
 * - a primeira commitou → ON CONFLICT não insere, e o SELECT (novo snapshot em
 *   Read Committed) enxerga a resposta gravada → replay ou mismatch;
 * - a primeira fez rollback → o INSERT segue e esta transação assume a chave.
 * Chave expirada (TRF-BR-12) ainda não apagada pelo job é reaproveitada como nova.
 */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Database) {}

  async acquire(input: {
    clientId: string;
    key: string;
    requestHash: string;
  }): Promise<IdempotencyAcquireResult> {
    try {
      const inserted = await this.db.query(
        `INSERT INTO idempotency_keys (client_id, key, request_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '24 hours')
         ON CONFLICT (client_id, key) DO UPDATE
            SET request_hash = EXCLUDED.request_hash,
                created_at = now(),
                expires_at = EXCLUDED.expires_at,
                transfer_id = NULL,
                response_status = NULL,
                response_body = NULL
          WHERE idempotency_keys.expires_at <= now()
         RETURNING 1`,
        [input.clientId, input.key, input.requestHash],
      );
      if (inserted.rowCount === 1) return { kind: 'acquired' };
    } catch (error) {
      if (error instanceof ResourceBusyError) throw new RequestInProgressError({ cause: error });
      throw error;
    }

    const { rows } = await this.db.query<KeyRow>(
      `SELECT request_hash, response_status, response_body
         FROM idempotency_keys
        WHERE client_id = $1 AND key = $2`,
      [input.clientId, input.key],
    );
    const row = rows[0];
    // Linha commitada sempre tem resposta (só 201 é gravado); sem ela, trate como em andamento.
    if (row === undefined) throw new RequestInProgressError();
    if (row.response_status === null) throw new RequestInProgressError();
    if (row.request_hash !== input.requestHash) return { kind: 'mismatch' };
    return {
      kind: 'replay',
      status: row.response_status,
      body: TransferSchema.parse(row.response_body),
    };
  }

  async complete(input: {
    clientId: string;
    key: string;
    transferId: string;
    status: number;
    body: TransferResponse;
  }): Promise<void> {
    await this.db.query(
      `UPDATE idempotency_keys
          SET transfer_id = $3, response_status = $4, response_body = $5::jsonb
        WHERE client_id = $1 AND key = $2`,
      [input.clientId, input.key, input.transferId, input.status, JSON.stringify(input.body)],
    );
  }
}
