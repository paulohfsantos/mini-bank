import {
  TRANSFER_COMPLETED,
  type Transfer as TransferResponse,
  type TransferCompletedEventV1,
} from '@mini-banco/contracts';
import type { Transfer } from '../domain/transfer';

export function toTransferResponse(transfer: Transfer): TransferResponse {
  return {
    id: transfer.id,
    sourceAccountId: transfer.sourceAccountId,
    destinationAccountId: transfer.destinationAccountId,
    amountCents: transfer.amount.toSafeNumber(),
    status: transfer.status,
    createdAt: transfer.createdAt.toISOString(),
  };
}

/** Evento só com ids e valor: nada de CPF ou nome (SEC-21). */
export function toTransferCompletedEvent(
  eventId: string,
  transfer: Transfer,
): TransferCompletedEventV1 {
  const completedAt = transfer.createdAt.toISOString();
  return {
    eventId,
    eventType: TRANSFER_COMPLETED,
    eventVersion: 1,
    occurredAt: completedAt,
    correlationId: transfer.correlationId,
    data: {
      transferId: transfer.id,
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      amountCents: transfer.amount.toSafeNumber(),
      completedAt,
    },
  };
}
