import { createLogger } from '@mini-banco/observability';
import { describe, expect, it } from 'vitest';
import type { Cleanup } from '../application/cleanup';
import type { OutboxRelay, RelayCycleResult } from '../application/outbox-relay';
import { RelayRunner } from './relay-runner';

const logger = createLogger({ service: 'test', level: 'silent' });
const empty: RelayCycleResult = { claimed: 0, published: 0, failed: 0, errors: [] };
const noCleanup = {
  run: () => Promise.resolve({ outbox: 0, idempotencyKeys: 0 }),
} as unknown as Cleanup;

function fakeRelay(cycle: () => Promise<RelayCycleResult>) {
  let runs = 0;
  const relay = {
    batchSize: 10,
    runOnce: async () => {
      runs += 1;
      return cycle();
    },
  } as unknown as OutboxRelay;
  return { relay, runs: () => runs };
}

describe('RelayRunner', () => {
  it('[PERF-22] stop() espera o ciclo em andamento e não reivindica mais nada depois', async () => {
    let finishCycle: () => void = () => undefined;
    let cycleDone = false;
    const { relay, runs } = fakeRelay(
      () =>
        new Promise((resolve) => {
          finishCycle = () => {
            cycleDone = true;
            resolve(empty);
          };
        }),
    );
    const runner = new RelayRunner(relay, noCleanup, logger, {
      intervalMs: 10,
      cleanupIntervalMs: 1e9,
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 5));

    const stopping = runner.stop();
    setTimeout(() => finishCycle(), 20);
    await stopping;

    expect(cycleDone).toBe(true); // stop só resolveu depois do ciclo terminar
    const after = runs();
    await new Promise((r) => setTimeout(r, 50));
    expect(runs()).toBe(after);
  });

  it('[OBX-BR-03] erro num ciclo não derruba o loop', async () => {
    let calls = 0;
    const { relay } = fakeRelay(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('db down')) : Promise.resolve(empty);
    });
    const runner = new RelayRunner(relay, noCleanup, logger, {
      intervalMs: 5,
      cleanupIntervalMs: 1e9,
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 60));
    await runner.stop();
    expect(calls).toBeGreaterThan(2);
  });

  it('[OBX-BR-03] lote cheio dispara o próximo ciclo sem esperar o intervalo', async () => {
    const { relay, runs } = fakeRelay(() =>
      Promise.resolve({ claimed: runs() <= 3 ? 10 : 0, published: 10, failed: 0, errors: [] }),
    );
    const runner = new RelayRunner(relay, noCleanup, logger, {
      intervalMs: 10_000,
      cleanupIntervalMs: 1e9,
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 30));
    await runner.stop();
    expect(runs()).toBeGreaterThanOrEqual(4);
  });
});

describe('RelayRunner.healthy (heartbeat da readiness)', () => {
  const opts = { intervalMs: 5, cleanupIntervalMs: 1e9 };

  it('[OBS-AC-11] parado não é saudável; rodando, ciclo recente é saudável', async () => {
    const { relay } = fakeRelay(() => Promise.resolve(empty));
    const runner = new RelayRunner(relay, noCleanup, logger, opts);
    expect(runner.healthy()).toBe(false);
    runner.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(runner.healthy()).toBe(true);
    await runner.stop();
    expect(runner.healthy()).toBe(false);
  });

  it('[OBS-AC-11] sem ciclo concluído há 30 s (loop travado ou banco fora) deixa de ser saudável', async () => {
    const { relay } = fakeRelay(() => Promise.reject(new Error('db down')));
    const runner = new RelayRunner(relay, noCleanup, logger, opts);
    runner.start();
    await new Promise((r) => setTimeout(r, 20));
    // Ciclos que lançam não renovam o heartbeat: só a tolerância do start conta.
    expect(runner.healthy(Date.now() + 29_000)).toBe(true);
    expect(runner.healthy(Date.now() + 31_000)).toBe(false);
    await runner.stop();
  });

  it('[OBS-AC-11] falha de envio ao SQS conta como ciclo concluído (o outbox guarda os eventos)', async () => {
    const failed: RelayCycleResult = { claimed: 1, published: 0, failed: 1, errors: ['SQS down'] };
    const { relay } = fakeRelay(() => Promise.resolve(failed));
    const runner = new RelayRunner(relay, noCleanup, logger, opts);
    runner.start();
    await new Promise((r) => setTimeout(r, 20));
    const now = Date.now();
    expect(runner.healthy(now + 29_000)).toBe(true);
    await runner.stop();
  });
});
