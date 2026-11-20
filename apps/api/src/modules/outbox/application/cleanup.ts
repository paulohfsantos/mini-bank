import type { CleanupStore } from './ports';

export interface CleanupResult {
  outbox: number;
  idempotencyKeys: number;
}

/**
 * OBX-BR-04 / PERF-12: apaga em lotes pequenos (transações curtas, sem lock longo), até
 * esvaziar ou atingir o teto de lotes por execução, para não competir com o tráfego.
 */
export class Cleanup {
  constructor(
    private readonly store: CleanupStore,
    private readonly options = { batchSize: 1_000, maxBatches: 50, outboxRetentionDays: 7 },
  ) {}

  async run(): Promise<CleanupResult> {
    const outbox = await this.drain(() =>
      this.store.deletePublishedOutbox(this.options.outboxRetentionDays, this.options.batchSize),
    );
    const idempotencyKeys = await this.drain(() =>
      this.store.deleteExpiredIdempotencyKeys(this.options.batchSize),
    );
    return { outbox, idempotencyKeys };
  }

  private async drain(deleteBatch: () => Promise<number>): Promise<number> {
    let total = 0;
    for (let i = 0; i < this.options.maxBatches; i++) {
      const deleted = await deleteBatch();
      total += deleted;
      if (deleted < this.options.batchSize) break;
    }
    return total;
  }
}
