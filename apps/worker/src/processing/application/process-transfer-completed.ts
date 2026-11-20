import type { TransferCompletedEventV1 } from '@mini-banco/contracts';
import { TransferMismatchError } from '../domain/errors';
import {
  analyze,
  DEFAULT_RULES,
  type FraudRule,
  RULE_VERSION,
  velocityWindow,
} from '../domain/fraud';
import type {
  FraudReview,
  FraudReviews,
  IdGenerator,
  Notification,
  Notifications,
  Notifier,
  ProcessedMessages,
  TransferReader,
  UnitOfWork,
} from './ports';

/** Nome do consumidor em processed_messages: outro consumidor do mesmo evento teria o seu. */
export const CONSUMER = 'worker.transfer-completed';

export type ProcessResult =
  | { outcome: 'processed'; review: FraudReview; notifications: Notification[] }
  | { outcome: 'duplicate' };

/**
 * PRC-BR-02..07, tudo numa transação: dedupe → confirmação no banco → regras →
 * fraud_reviews → notifications. Qualquer erro desfaz inclusive o processed_messages,
 * então a mensagem pode ser reprocessada.
 */
export class ProcessTransferCompletedUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly processed: ProcessedMessages,
    private readonly transfers: TransferReader,
    private readonly reviews: FraudReviews,
    private readonly notifications: Notifications,
    private readonly notifier: Notifier,
    private readonly rules: readonly FraudRule[] = DEFAULT_RULES,
  ) {}

  async execute(event: TransferCompletedEventV1): Promise<ProcessResult> {
    const result = await this.uow.run(async (): Promise<ProcessResult> => {
      if (!(await this.processed.markProcessed(CONSUMER, event.eventId))) {
        return { outcome: 'duplicate' };
      }

      const { data } = event;
      const stored = await this.transfers.findById(data.transferId);
      if (!stored) throw new TransferMismatchError(data.transferId, ['missing']);
      const fields = [
        stored.sourceAccountId !== data.sourceAccountId && ('sourceAccountId' as const),
        stored.destinationAccountId !== data.destinationAccountId &&
          ('destinationAccountId' as const),
        stored.amountCents !== BigInt(data.amountCents) && ('amountCents' as const),
      ].filter((f) => f !== false);
      if (fields.length > 0) throw new TransferMismatchError(data.transferId, fields);

      const { from, to } = velocityWindow(new Date(data.completedAt));
      const sourceTransfersInWindow = await this.transfers.countBySourceBetween(
        data.sourceAccountId,
        from,
        to,
      );
      const { status, reasons } = analyze(this.rules, {
        amountCents: data.amountCents,
        sourceTransfersInWindow,
      });

      const review: FraudReview = {
        id: this.ids.next(),
        transferId: data.transferId,
        status,
        reasons,
        ruleVersion: RULE_VERSION,
      };
      await this.reviews.insert(review);

      const notifications: Notification[] = [
        {
          id: this.ids.next(),
          transferId: data.transferId,
          accountId: data.sourceAccountId,
          type: 'TRANSFER_SENT',
          channel: 'LOG',
        },
        {
          id: this.ids.next(),
          transferId: data.transferId,
          accountId: data.destinationAccountId,
          type: 'TRANSFER_RECEIVED',
          channel: 'LOG',
        },
      ];
      await this.notifications.insertMany(notifications);
      return { outcome: 'processed', review, notifications };
    });

    // Depois do commit: não "notifica" o que pode ter sido desfeito.
    if (result.outcome === 'processed')
      result.notifications.forEach((n) => this.notifier.notify(n));
    return result;
  }
}
