import type { Transfer as TransferResponse, TransferCompletedEventV1 } from '@mini-banco/contracts';
import type { Money } from '../../../shared/domain/money';
import type { Transfer } from '../domain/transfer';

export interface NewTransfer {
  id: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: Money;
  correlationId: string;
}

export interface TransferRepository {
  insert(transfer: NewTransfer): Promise<Transfer>;
  findById(id: string): Promise<Transfer | null>;
}
export const TRANSFER_REPOSITORY = Symbol('TransferRepository');

export type IdempotencyAcquireResult =
  | { kind: 'acquired' }
  | { kind: 'replay'; status: number; body: TransferResponse }
  | { kind: 'mismatch' };

/** ADR-0008. Escopo por cliente da API (TRF-BR-08). */
export interface IdempotencyStore {
  /**
   * Primeiro passo da transação (TRF-BR-05). Bloqueia enquanto outra transação segura a
   * mesma chave; além do lock_timeout lança RequestInProgressError.
   */
  acquire(input: {
    clientId: string;
    key: string;
    requestHash: string;
  }): Promise<IdempotencyAcquireResult>;
  /** Grava a resposta no mesmo commit da transferência (só 201; TRF-BR-11). */
  complete(input: {
    clientId: string;
    key: string;
    transferId: string;
    status: number;
    body: TransferResponse;
  }): Promise<void>;
}
export const IDEMPOTENCY_STORE = Symbol('IdempotencyStore');

export interface OutboxWriter {
  add(event: TransferCompletedEventV1, options?: { traceparent?: string }): Promise<void>;
}
export const OUTBOX_WRITER = Symbol('OutboxWriter');
