import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from '@mini-banco/observability';
import type { Cleanup } from '../application/cleanup';
import type { OutboxRelay } from '../application/outbox-relay';

export interface RelayRunnerOptions {
  /** OBX-BR-03: 1 s entre ciclos. Lote cheio → próximo ciclo imediato (drena backlog). */
  intervalMs: number;
  /** OBX-BR-04: limpeza a cada hora. */
  cleanupIntervalMs: number;
}

/**
 * Loop do relay. `stop()` (SIGTERM) para de reivindicar e espera o ciclo em andamento
 * terminar; só depois o pool é fechado (PERF-22). O que já foi reivindicado e não
 * publicado volta a ser elegível quando o claim expirar.
 */
export class RelayRunner {
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;
  private lastCleanup = 0;

  constructor(
    private readonly relay: OutboxRelay,
    private readonly cleanup: Cleanup,
    private readonly logger: Logger,
    private readonly options: RelayRunnerOptions = {
      intervalMs: 1_000,
      cleanupIntervalMs: 3_600_000,
    },
  ) {}

  start(): void {
    if (this.loop) return;
    this.lastCleanup = Date.now(); // primeira limpeza uma hora depois do boot
    this.loop = this.run();
    this.logger.info({ component: 'outbox-relay' }, 'outbox relay started');
  }

  async stop(): Promise<void> {
    if (!this.loop) return;
    this.abort.abort();
    await this.loop;
    this.loop = undefined;
    this.logger.info({ component: 'outbox-relay' }, 'outbox relay stopped');
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      let fullBatch = false;
      try {
        const result = await this.relay.runOnce();
        fullBatch = result.claimed === this.relay.batchSize;
        if (result.failed > 0) {
          this.logger.warn(
            { component: 'outbox-relay', ...result },
            'outbox publish failed; rows retry after claim expiry',
          );
        } else if (result.published > 0) {
          this.logger.debug({ component: 'outbox-relay', ...result }, 'outbox published');
        }
        await this.maybeCleanup();
      } catch (error) {
        // Banco indisponível etc.: o loop sobrevive e tenta no próximo ciclo.
        this.logger.error(
          { component: 'outbox-relay', err: { message: (error as Error).message } },
          'outbox relay cycle failed',
        );
      }
      if (fullBatch || signal.aborted) continue;
      await sleep(this.options.intervalMs, undefined, { signal }).catch(() => undefined);
    }
  }

  private async maybeCleanup(): Promise<void> {
    if (Date.now() - this.lastCleanup < this.options.cleanupIntervalMs) return;
    this.lastCleanup = Date.now();
    const result = await this.cleanup.run();
    this.logger.info({ component: 'outbox-cleanup', deleted: result }, 'cleanup finished');
  }
}
