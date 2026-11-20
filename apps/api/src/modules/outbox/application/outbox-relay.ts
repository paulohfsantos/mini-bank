import type { EventPublisher, OutboxStore } from './ports';

export interface RelayCycleResult {
  claimed: number;
  published: number;
  failed: number;
  errors: string[];
}

export interface OutboxRelayOptions {
  batchSize: number;
  claimTtlMs: number;
}

export const DEFAULT_RELAY_OPTIONS: OutboxRelayOptions = { batchSize: 10, claimTtlMs: 30_000 };

/**
 * Um ciclo do relay (ADR-0006): claim (transação curta, commitada) → envio fora de
 * transação → marca publicados/falhos. Entrega at-least-once: se o processo cair entre o
 * envio e a marcação, o claim expira e o evento sai de novo; o worker é idempotente.
 */
export class OutboxRelay {
  constructor(
    private readonly store: OutboxStore,
    private readonly publisher: EventPublisher,
    private readonly options: OutboxRelayOptions = DEFAULT_RELAY_OPTIONS,
  ) {}

  get batchSize(): number {
    return this.options.batchSize;
  }

  async runOnce(): Promise<RelayCycleResult> {
    const events = await this.store.claim(this.options.batchSize, this.options.claimTtlMs);
    if (events.length === 0) return { claimed: 0, published: 0, failed: 0, errors: [] };

    const { published, failed } = await this.publisher.publish(events);
    if (published.length > 0) await this.store.markPublished(published);
    if (failed.length > 0) await this.store.markFailed(failed);

    return {
      claimed: events.length,
      published: published.length,
      failed: failed.length,
      errors: [...new Set(failed.map((f) => f.error))],
    };
  }
}
