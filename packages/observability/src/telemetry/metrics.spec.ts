import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startTestTelemetry, type TestTelemetry } from '../test-support/telemetry';
import { appMetrics, METRIC_ATTRIBUTE_KEYS } from './metrics';

let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = startTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe('appMetrics', () => {
  it('[OBS-AC-07] counters de transferência por reason', async () => {
    appMetrics.transferCompleted();
    appMetrics.transferRejected('INSUFFICIENT_FUNDS');
    appMetrics.transferRejected('INSUFFICIENT_FUNDS');
    appMetrics.transferRejected('SAME_ACCOUNT');
    expect(await telemetry.value('transfers_completed')).toBe(1);
    expect(await telemetry.value('transfers_rejected', { reason: 'INSUFFICIENT_FUNDS' })).toBe(2);
    expect(await telemetry.value('transfers_rejected', { reason: 'SAME_ACCOUNT' })).toBe(1);
  });

  it('[OBS-AC-08] fraude por regra, processamento por outcome, lag e gauge do outbox', async () => {
    appMetrics.fraudFlagged(['HIGH_AMOUNT', 'HIGH_VELOCITY']);
    appMetrics.fraudFlagged(['HIGH_AMOUNT']);
    appMetrics.workerProcessed('processed', 4);
    appMetrics.workerProcessed('retry', 2);
    appMetrics.outboxPublished(120);
    const stop = appMetrics.observeOutboxPending(() => Promise.resolve(7));

    expect(await telemetry.value('fraud_flagged', { rule: 'HIGH_AMOUNT' })).toBe(2);
    expect(await telemetry.value('fraud_flagged', { rule: 'HIGH_VELOCITY' })).toBe(1);
    expect(await telemetry.value('worker_processing_ms', { outcome: 'processed' })).toBe(1);
    expect(await telemetry.value('outbox_publish_lag_ms')).toBe(1);
    expect(await telemetry.value('outbox_pending')).toBe(7);
    stop();
  });

  it('[OBS-AC-08] gauge sem observação quando a leitura falha', async () => {
    const stop = appMetrics.observeOutboxPending(() => Promise.reject(new Error('db down')));
    const gauge = (await telemetry.metrics()).find((m) => m.descriptor.name === 'outbox_pending');
    expect(gauge?.dataPoints ?? []).toHaveLength(0);
    stop();
  });

  it('[OBS-AC-09] atributos só das chaves permitidas', async () => {
    appMetrics.transferCompleted();
    appMetrics.transferRejected('ACCOUNT_NOT_FOUND');
    appMetrics.fraudFlagged(['HIGH_AMOUNT']);
    appMetrics.workerProcessed('duplicate', 1);
    appMetrics.outboxPublished(5);
    const keys = (await telemetry.metrics()).flatMap((m) =>
      m.dataPoints.flatMap((p) => Object.keys(p.attributes)),
    );
    for (const key of keys) expect(METRIC_ATTRIBUTE_KEYS).toContain(key);
  });
});
