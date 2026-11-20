// Ports do relay do outbox (ADR-0006). Sem Nest, sem pg, sem SDK da AWS.

export const OUTBOX_STORE = Symbol('OutboxStore');
export const EVENT_PUBLISHER = Symbol('EventPublisher');
export const CLEANUP_STORE = Symbol('CleanupStore');

export interface PendingEvent {
  id: string;
  eventType: string;
  /** Corpo do evento como gravado (jsonb), já validado no momento da escrita. */
  payload: unknown;
  correlationId: string;
  traceparent: string | null;
  attempts: number;
}

export interface PublishFailure {
  id: string;
  error: string;
}

export interface OutboxStore {
  /**
   * OBX-BR-01: em transação curta e já commitada ao retornar, reivindica até `limit` linhas
   * pendentes (claim ausente ou expirado) com FOR UPDATE SKIP LOCKED, por `created_at`.
   */
  claim(limit: number, claimTtlMs: number): Promise<PendingEvent[]>;
  markPublished(ids: readonly string[]): Promise<void>;
  /** OBX-BR-02: guarda o erro; a linha volta a ser elegível quando o claim expirar. */
  markFailed(failures: readonly PublishFailure[]): Promise<void>;
}

export interface EventPublisher {
  /** Chamado FORA de transação (PERF-04). Nunca lança: falhas voltam em `failed`. */
  publish(
    events: readonly PendingEvent[],
  ): Promise<{ published: string[]; failed: PublishFailure[] }>;
}

export interface CleanupStore {
  /** Apaga um lote de linhas publicadas há mais de `olderThanDays`; devolve quantas. */
  deletePublishedOutbox(olderThanDays: number, batchSize: number): Promise<number>;
  /** Apaga um lote de chaves de idempotência expiradas (TRF-BR-12); devolve quantas. */
  deleteExpiredIdempotencyKeys(batchSize: number): Promise<number>;
}
