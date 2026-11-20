// Adapters Postgres do worker. Rodam como mini_banco_worker: SELECT em transfers e
// INSERT só nas tabelas do worker (migration 0002).
import { type Database, uuidv7 } from '@mini-banco/database';
import type {
  FraudReview,
  FraudReviews,
  IdGenerator,
  Notification,
  Notifications,
  ProcessedMessages,
  StoredTransfer,
  TransferReader,
  UnitOfWork,
} from '../application/ports';

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}
  run<T>(work: () => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}

export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}

export class PgProcessedMessages implements ProcessedMessages {
  constructor(private readonly db: Database) {}
  async markProcessed(consumer: string, eventId: string): Promise<boolean> {
    // Duplicata concorrente espera no PK até o commit da primeira e então cai no DO NOTHING.
    const result = await this.db.query(
      `INSERT INTO processed_messages (consumer, event_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [consumer, eventId],
    );
    return result.rowCount === 1;
  }
}

interface TransferRow {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  amount_cents: bigint;
}

export class PgTransferReader implements TransferReader {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<StoredTransfer | null> {
    const { rows } = await this.db.query<TransferRow>(
      `SELECT id, source_account_id, destination_account_id, amount_cents
         FROM transfers WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          sourceAccountId: row.source_account_id,
          destinationAccountId: row.destination_account_id,
          amountCents: row.amount_cents,
        }
      : null;
  }

  // Índice transfers_source_created_idx (source_account_id, created_at).
  async countBySourceBetween(sourceAccountId: string, from: Date, to: Date): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM transfers
        WHERE source_account_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [sourceAccountId, from, to],
    );
    return rows[0]?.n ?? 0;
  }
}

export class PgFraudReviews implements FraudReviews {
  constructor(private readonly db: Database) {}
  async insert(review: FraudReview): Promise<void> {
    await this.db.query(
      `INSERT INTO fraud_reviews (id, transfer_id, status, reasons, rule_version)
       VALUES ($1, $2, $3, $4::text[], $5)`,
      [review.id, review.transferId, review.status, review.reasons, review.ruleVersion],
    );
  }
}

export class PgNotifications implements Notifications {
  constructor(private readonly db: Database) {}
  async insertMany(notifications: readonly Notification[]): Promise<void> {
    await this.db.query(
      `INSERT INTO notifications (id, transfer_id, account_id, type, channel)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[])`,
      [
        notifications.map((n) => n.id),
        notifications.map((n) => n.transferId),
        notifications.map((n) => n.accountId),
        notifications.map((n) => n.type),
        notifications.map((n) => n.channel),
      ],
    );
  }
}
