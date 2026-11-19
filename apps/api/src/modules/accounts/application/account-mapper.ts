import type { Account as AccountResponse } from '@mini-banco/contracts';
import type { Account } from '../domain/account';

/** ACC-BR-06: só o CPF mascarado sai pela API. */
export function toAccountResponse(account: Account): AccountResponse {
  return {
    id: account.id,
    holderName: account.holderName,
    documentMasked: account.document.masked,
    balanceCents: account.balance.toSafeNumber(),
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
