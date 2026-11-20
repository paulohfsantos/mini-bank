import type { FraudReason, ReviewStatus } from '../domain/fraud';

export const UNIT_OF_WORK = Symbol('UnitOfWork');
export const ID_GENERATOR = Symbol('IdGenerator');
export const PROCESSED_MESSAGES = Symbol('ProcessedMessages');
export const TRANSFER_READER = Symbol('TransferReader');
export const FRAUD_REVIEWS = Symbol('FraudReviews');
export const NOTIFICATIONS = Symbol('Notifications');
export const NOTIFIER = Symbol('Notifier');

export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  next(): string;
}

export interface ProcessedMessages {
  /** PRC-BR-02: true se é a primeira vez (linha inserida); false se já processada. */
  markProcessed(consumer: string, eventId: string): Promise<boolean>;
}

export interface StoredTransfer {
  id: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: bigint;
}

export interface TransferReader {
  findById(id: string): Promise<StoredTransfer | null>;
  /** Transferências da origem com created_at em [from, to] (inclusive). */
  countBySourceBetween(sourceAccountId: string, from: Date, to: Date): Promise<number>;
}

export interface FraudReview {
  id: string;
  transferId: string;
  status: ReviewStatus;
  reasons: FraudReason[];
  ruleVersion: string;
}

export interface FraudReviews {
  insert(review: FraudReview): Promise<void>;
}

export type NotificationType = 'TRANSFER_SENT' | 'TRANSFER_RECEIVED';

export interface Notification {
  id: string;
  transferId: string;
  accountId: string;
  type: NotificationType;
  channel: 'LOG';
}

export interface Notifications {
  insertMany(notifications: readonly Notification[]): Promise<void>;
}

/** Entrega simulada (PRC-BR-07): chamada só depois do commit. */
export interface Notifier {
  notify(notification: Notification): void;
}
