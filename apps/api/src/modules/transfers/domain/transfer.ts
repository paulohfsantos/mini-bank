import { SameAccountError } from '../../../shared/domain/errors';
import type { Money } from '../../../shared/domain/money';

export type TransferStatus = 'COMPLETED';

export interface Transfer {
  id: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: Money;
  status: TransferStatus;
  correlationId: string;
  createdAt: Date;
}

/** TRF-BR-02. */
export function assertDistinctAccounts(
  sourceAccountId: string,
  destinationAccountId: string,
): void {
  if (sourceAccountId === destinationAccountId) throw new SameAccountError();
}
