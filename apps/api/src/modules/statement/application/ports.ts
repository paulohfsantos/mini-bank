import type { LedgerEntryType } from '../../../shared/domain/ledger-entry';
import type { Money } from '../../../shared/domain/money';

/** Posição do keyset: created_at em microssegundos (precisão do Postgres) + id. */
export interface StatementPosition {
  createdAtMicros: bigint;
  id: string;
}

export interface StatementEntry {
  id: string;
  type: LedgerEntryType;
  amount: Money;
  balanceAfter: Money;
  transferId: string | null;
  counterpartyAccountId: string | null;
  createdAt: Date;
  position: StatementPosition;
}

export interface StatementRepository {
  /** Até `limit` lançamentos estritamente "depois" de `after`, em ordem (created_at, id) decrescente. */
  page(accountId: string, limit: number, after?: StatementPosition): Promise<StatementEntry[]>;
}
export const STATEMENT_REPOSITORY = Symbol('StatementRepository');
