import type { TransferCompletedEventV1 } from '@mini-banco/contracts';
import type { Database } from '@mini-banco/database';
import type { OutboxWriter } from '../application/ports';

/** Transactional outbox (ADR-0006): só grava; quem publica é o OutboxRelay (fase 3). */
export class PgOutboxWriter implements OutboxWriter {
  constructor(private readonly db: Database) {}

  async add(
    event: TransferCompletedEventV1,
    options: { traceparent?: string } = {},
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO outbox (id, aggregate_id, event_type, payload, correlation_id, traceparent)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        event.eventId,
        event.data.transferId,
        event.eventType,
        JSON.stringify(event),
        event.correlationId,
        options.traceparent ?? null,
      ],
    );
  }
}
