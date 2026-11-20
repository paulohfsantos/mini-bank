import type { Logger } from '@mini-banco/observability';
import type { Notification, Notifier } from '../application/ports';

/** Canal LOG (PRC-BR-07): a "entrega" é uma linha estruturada, só com ids. */
export class LogNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}
  notify(n: Notification): void {
    this.logger.info(
      {
        notification: { id: n.id, type: n.type, transferId: n.transferId, accountId: n.accountId },
      },
      'notification sent',
    );
  }
}
