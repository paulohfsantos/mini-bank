import type { Database } from '@mini-banco/database';
import type { LedgerEntryType } from '../../../shared/domain/ledger-entry';
import { Money } from '../../../shared/domain/money';
import type { StatementEntry, StatementPosition, StatementRepository } from '../application/ports';

interface EntryRow {
  id: string;
  type: LedgerEntryType;
  amount_cents: bigint;
  balance_after_cents: bigint;
  transfer_id: string | null;
  counterparty_account_id: string | null;
  created_at: Date;
  created_at_micros: bigint;
}

const SELECT = `
  SELECT l.id, l.type, l.amount_cents, l.balance_after_cents, l.transfer_id, l.created_at,
         (extract(epoch FROM l.created_at) * 1000000)::bigint AS created_at_micros,
         CASE l.type
           WHEN 'DEBIT'  THEN t.destination_account_id
           WHEN 'CREDIT' THEN t.source_account_id
         END AS counterparty_account_id
    FROM ledger_entries l
    LEFT JOIN transfers t ON t.id = l.transfer_id
   WHERE l.account_id = $1`;

const ORDER = 'ORDER BY l.created_at DESC, l.id DESC LIMIT $2';

/** Primeira página. */
export const FIRST_PAGE_SQL = `${SELECT} ${ORDER}`;

/**
 * Páginas seguintes: comparação de linha (created_at, id) < (cursor), que o Postgres resolve
 * como condição do índice (account_id, created_at DESC, id DESC) (ADR-0016, PERF-11).
 * Duas queries separadas, em vez de um "cursor IS NULL OR ...", para o planner sempre usar
 * o índice. Microssegundos → timestamptz por aritmética de interval (exato até ~2255).
 */
export const NEXT_PAGE_SQL = `${SELECT}
     AND (l.created_at, l.id) < ('epoch'::timestamptz + $3::bigint * interval '1 microsecond', $4::uuid)
   ${ORDER}`;

function toEntry(row: EntryRow): StatementEntry {
  return {
    id: row.id,
    type: row.type,
    amount: Money.fromCents(row.amount_cents),
    balanceAfter: Money.fromCents(row.balance_after_cents),
    transferId: row.transfer_id,
    counterpartyAccountId: row.counterparty_account_id,
    createdAt: row.created_at,
    position: { createdAtMicros: row.created_at_micros, id: row.id },
  };
}

export class PgStatementRepository implements StatementRepository {
  constructor(private readonly db: Database) {}

  async page(
    accountId: string,
    limit: number,
    after?: StatementPosition,
  ): Promise<StatementEntry[]> {
    const { rows } = after
      ? await this.db.query<EntryRow>(NEXT_PAGE_SQL, [
          accountId,
          limit,
          after.createdAtMicros.toString(),
          after.id,
        ])
      : await this.db.query<EntryRow>(FIRST_PAGE_SQL, [accountId, limit]);
    return rows.map(toEntry);
  }
}
