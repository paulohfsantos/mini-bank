// Adapters de persistência compartilhados: unidade de trabalho, ids e ledger.
import { type Database, uuidv7 } from '@mini-banco/database';
import type { IdGenerator, LedgerRepository, UnitOfWork } from '../application/ports';
import type { NewLedgerEntry } from '../domain/ledger-entry';

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

export class PgLedgerRepository implements LedgerRepository {
  constructor(private readonly db: Database) {}

  /** Um INSERT para N lançamentos via unnest: SQL estático, valores só em parâmetros. */
  async append(entries: readonly NewLedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.db.query(
      `INSERT INTO ledger_entries (id, account_id, transfer_id, type, amount_cents, balance_after_cents)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::bigint[], $6::bigint[])`,
      [
        entries.map((e) => e.id),
        entries.map((e) => e.accountId),
        entries.map((e) => e.transferId),
        entries.map((e) => e.type),
        entries.map((e) => e.amount.toString()),
        entries.map((e) => e.balanceAfter.toString()),
      ],
    );
  }
}
