// PRC-BR-09: erro não retentável vai rápido para a DLQ; o resto é tratado como transitório.

export abstract class NonRetryableError extends Error {
  abstract readonly kind: 'INVALID_PAYLOAD' | 'TRANSFER_MISMATCH';
}

/** PRC-BR-01. `issues` traz só caminho + mensagem do zod, nunca o corpo da mensagem. */
export class InvalidPayloadError extends NonRetryableError {
  readonly kind = 'INVALID_PAYLOAD';
  constructor(readonly issues: { path: string; message: string }[]) {
    super('payload inválido para transfer.completed v1');
  }
}

/** PRC-BR-03 / SEC-14: evento que não bate com o banco (forjado, corrompido ou de outro ambiente). */
export class TransferMismatchError extends NonRetryableError {
  readonly kind = 'TRANSFER_MISMATCH';
  constructor(
    readonly transferId: string,
    /** Quais campos divergem (`missing` se a transferência não existe). */
    readonly fields: ('missing' | 'sourceAccountId' | 'destinationAccountId' | 'amountCents')[],
  ) {
    super('evento não corresponde à transferência no banco');
  }
}
