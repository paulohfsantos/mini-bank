import type { Database } from '@mini-banco/database';
import type { CleanupStore, OutboxStore, PendingEvent, PublishFailure } from '../application/ports';

// OBX-BR-01. A subquery escolhe e trava as linhas (SKIP LOCKED: outra instância do relay
// pula as que já estão sendo reivindicadas, OBX-AC-03); o UPDATE grava o claim. Usa o
// índice parcial outbox_pending_idx (created_at) WHERE published_at IS NULL.
export const CLAIM_SQL = `
  UPDATE outbox
     SET claimed_until = now() + $2::int * interval '1 millisecond',
         attempts = attempts + 1
   WHERE id IN (
         SELECT id
           FROM outbox
          WHERE published_at IS NULL
            AND (claimed_until IS NULL OR claimed_until < now())
          ORDER BY created_at
          LIMIT $1
            FOR UPDATE SKIP LOCKED)
  RETURNING id, event_type, payload, correlation_id, traceparent, attempts, created_at`;

const MARK_PUBLISHED_SQL = `
  UPDATE outbox
     SET published_at = now(), claimed_until = NULL, last_error = NULL
   WHERE id = ANY($1::uuid[])`;

// O claim fica como está: a linha volta a ser elegível quando ele expirar (OBX-BR-02).
const MARK_FAILED_SQL = `
  UPDATE outbox o
     SET last_error = f.error
    FROM unnest($1::uuid[], $2::text[]) AS f(id, error)
   WHERE o.id = f.id`;

const DELETE_PUBLISHED_SQL = `
  DELETE FROM outbox
   WHERE id IN (SELECT id FROM outbox
                 WHERE published_at < now() - $1::int * interval '1 day'
                 LIMIT $2)`;

const DELETE_EXPIRED_KEYS_SQL = `
  DELETE FROM idempotency_keys
   WHERE (client_id, key) IN (SELECT client_id, key FROM idempotency_keys
                               WHERE expires_at <= now()
                               LIMIT $1)`;

interface ClaimRow {
  id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string;
  traceparent: string | null;
  attempts: number;
  created_at: Date;
}

export class PgOutboxStore implements OutboxStore {
  constructor(private readonly db: Database) {}

  async claim(limit: number, claimTtlMs: number): Promise<PendingEvent[]> {
    // Transação própria e curta: commit antes de qualquer chamada ao SQS (PERF-04).
    const { rows } = await this.db.transaction(() =>
      this.db.query<ClaimRow>(CLAIM_SQL, [limit, claimTtlMs]),
    );
    // RETURNING não garante ordem; publica na ordem de criação.
    return rows
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map((r) => ({
        id: r.id,
        eventType: r.event_type,
        payload: r.payload,
        correlationId: r.correlation_id,
        traceparent: r.traceparent,
        attempts: r.attempts,
      }));
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    await this.db.transaction(() => this.db.query(MARK_PUBLISHED_SQL, [ids]));
  }

  async markFailed(failures: readonly PublishFailure[]): Promise<void> {
    await this.db.transaction(() =>
      this.db.query(MARK_FAILED_SQL, [failures.map((f) => f.id), failures.map((f) => f.error)]),
    );
  }
}

export class PgCleanupStore implements CleanupStore {
  constructor(private readonly db: Database) {}

  async deletePublishedOutbox(olderThanDays: number, batchSize: number): Promise<number> {
    const result = await this.db.transaction(() =>
      this.db.query(DELETE_PUBLISHED_SQL, [olderThanDays, batchSize]),
    );
    return result.rowCount ?? 0;
  }

  async deleteExpiredIdempotencyKeys(batchSize: number): Promise<number> {
    const result = await this.db.transaction(() =>
      this.db.query(DELETE_EXPIRED_KEYS_SQL, [batchSize]),
    );
    return result.rowCount ?? 0;
  }
}
