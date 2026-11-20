import { describe, expect, it } from 'vitest';
import { Cleanup } from './cleanup';
import { OutboxRelay } from './outbox-relay';
import type {
  CleanupStore,
  EventPublisher,
  OutboxStore,
  PendingEvent,
  PublishFailure,
} from './ports';

const event = (id: string): PendingEvent => ({
  id,
  eventType: 'transfer.completed',
  payload: { eventId: id },
  correlationId: `c-${id}`,
  traceparent: null,
  attempts: 1,
});

class FakeStore implements OutboxStore {
  calls: string[] = [];
  published: string[] = [];
  failed: PublishFailure[] = [];
  constructor(private pending: PendingEvent[]) {}
  claim(limit: number) {
    this.calls.push('claim');
    const batch = this.pending.slice(0, limit);
    this.pending = this.pending.slice(limit);
    return Promise.resolve(batch);
  }
  markPublished(ids: readonly string[]) {
    this.calls.push('markPublished');
    this.published.push(...ids);
    return Promise.resolve();
  }
  markFailed(failures: readonly PublishFailure[]) {
    this.calls.push('markFailed');
    this.failed.push(...failures);
    return Promise.resolve();
  }
}

const publisher = (fail: Set<string> = new Set()): EventPublisher & { sent: string[] } => {
  const sent: string[] = [];
  return {
    sent,
    publish(events) {
      sent.push(...events.map((e) => e.id));
      return Promise.resolve({
        published: events.filter((e) => !fail.has(e.id)).map((e) => e.id),
        failed: events.filter((e) => fail.has(e.id)).map((e) => ({ id: e.id, error: 'boom' })),
      });
    },
  };
};

describe('OutboxRelay', () => {
  it('[OBX-BR-01] reivindica, publica e só então marca (claim → envio → marcação)', async () => {
    const store = new FakeStore([event('a'), event('b')]);
    const pub = publisher();
    const result = await new OutboxRelay(store, pub).runOnce();

    expect(store.calls).toEqual(['claim', 'markPublished']);
    expect(pub.sent).toEqual(['a', 'b']);
    expect(store.published).toEqual(['a', 'b']);
    expect(result).toMatchObject({ claimed: 2, published: 2, failed: 0 });
  });

  it('[OBX-BR-02] falhas parciais: publicados marcados, falhos com erro', async () => {
    const store = new FakeStore([event('a'), event('b'), event('c')]);
    const result = await new OutboxRelay(store, publisher(new Set(['b']))).runOnce();

    expect(store.published).toEqual(['a', 'c']);
    expect(store.failed).toEqual([{ id: 'b', error: 'boom' }]);
    expect(result).toMatchObject({ published: 2, failed: 1, errors: ['boom'] });
  });

  it('sem pendências não chama o SQS', async () => {
    const store = new FakeStore([]);
    const pub = publisher();
    await new OutboxRelay(store, pub).runOnce();
    expect(pub.sent).toEqual([]);
    expect(store.calls).toEqual(['claim']);
  });

  it('[OBX-BR-01] respeita o tamanho do lote (até 10 por ciclo)', async () => {
    const store = new FakeStore(Array.from({ length: 25 }, (_, i) => event(String(i))));
    const result = await new OutboxRelay(store, publisher()).runOnce();
    expect(result.claimed).toBe(10);
  });
});

describe('Cleanup', () => {
  class FakeCleanup implements CleanupStore {
    constructor(
      private outbox: number,
      private keys: number,
    ) {}
    deletePublishedOutbox(_days: number, batch: number) {
      const n = Math.min(batch, this.outbox);
      this.outbox -= n;
      return Promise.resolve(n);
    }
    deleteExpiredIdempotencyKeys(batch: number) {
      const n = Math.min(batch, this.keys);
      this.keys -= n;
      return Promise.resolve(n);
    }
  }

  it('[PERF-12] apaga em lotes até esvaziar', async () => {
    const cleanup = new Cleanup(new FakeCleanup(25, 7), {
      batchSize: 10,
      maxBatches: 50,
      outboxRetentionDays: 7,
    });
    expect(await cleanup.run()).toEqual({ outbox: 25, idempotencyKeys: 7 });
  });

  it('[PERF-12] para no teto de lotes por execução', async () => {
    const cleanup = new Cleanup(new FakeCleanup(1_000, 0), {
      batchSize: 10,
      maxBatches: 3,
      outboxRetentionDays: 7,
    });
    expect((await cleanup.run()).outbox).toBe(30);
  });
});
