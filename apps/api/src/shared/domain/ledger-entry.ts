import type { Money } from './money';

export type LedgerEntryType = 'OPENING' | 'DEBIT' | 'CREDIT';

/** Lançamento a gravar. `created_at` vem do banco (now() da transação). */
export interface NewLedgerEntry {
  id: string;
  accountId: string;
  transferId: string | null;
  type: LedgerEntryType;
  amount: Money;
  balanceAfter: Money;
}
