import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { Database } from '@mini-banco/database';
import { createSqsClient } from '@mini-banco/messaging';
import { appMetrics, type Logger } from '@mini-banco/observability';
import {
  RELAY_HEARTBEAT,
  type RelayHeartbeat,
} from '../../shared/infrastructure/http/health.controller';
import type { AppConfig } from '../../config';
import { Cleanup } from './application/cleanup';
import { OutboxRelay } from './application/outbox-relay';
import { PgCleanupStore, PgOutboxStore } from './infrastructure/pg-outbox.store';
import { RelayRunner } from './infrastructure/relay-runner';
import { SqsEventPublisher } from './infrastructure/sqs-event.publisher';

const SQS_CLIENT = Symbol('SqsClient');
const OUTBOX_STORE = Symbol('PgOutboxStore');

/**
 * Relay do outbox dentro do processo da API (ADR-0006). Só é montado com
 * OUTBOX_RELAY_ENABLED=true; desligado, a API apenas grava no outbox.
 */
@Module({})
export class OutboxModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private stopGauge: (() => void) | undefined;

  constructor(
    @Inject(RelayRunner) private readonly runner: RelayRunner,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(OUTBOX_STORE) private readonly store: PgOutboxStore,
  ) {}

  static forRoot(config: AppConfig['outbox'], logger: Logger): DynamicModule {
    if (!config.enabled || !config.queueUrl) return { module: OutboxDisabledModule };
    const queueUrl = config.queueUrl;
    return {
      module: OutboxModule,
      providers: [
        {
          provide: SQS_CLIENT,
          // maxAttempts 1: sem retries do SDK; o próximo ciclo é o retry (OBX-BR-02).
          useFactory: () =>
            createSqsClient({
              region: config.region,
              ...(config.endpoint ? { endpoint: config.endpoint } : {}),
              requestTimeoutMs: 3_000,
              maxAttempts: 1,
            }),
        },
        {
          provide: OUTBOX_STORE,
          useFactory: (db: Database) => new PgOutboxStore(db),
          inject: [Database],
        },
        {
          provide: RelayRunner,
          useFactory: (db: Database, sqs: SQSClient, store: PgOutboxStore) =>
            new RelayRunner(
              new OutboxRelay(store, new SqsEventPublisher(sqs, queueUrl)),
              new Cleanup(new PgCleanupStore(db)),
              logger,
            ),
          inject: [Database, SQS_CLIENT, OUTBOX_STORE],
        },
        {
          provide: RELAY_HEARTBEAT,
          useFactory: (runner: RelayRunner): RelayHeartbeat => ({
            healthy: (now) => runner.healthy(now),
          }),
          inject: [RelayRunner],
        },
      ],
      exports: [RELAY_HEARTBEAT],
    };
  }

  onApplicationBootstrap(): void {
    this.runner.start();
    // OBS-BR-07: lido a cada coleta (scrape), com prazo de 1 s; falha = sem observação.
    this.stopGauge = appMetrics.observeOutboxPending(() => this.store.countPending(1_000));
  }

  /** Antes do DatabaseModule fechar o pool (onApplicationShutdown): PERF-22. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopGauge?.();
    await this.runner.stop();
  }

  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}

/** Relay desligado: nada a verificar na readiness. */
@Module({
  providers: [
    { provide: RELAY_HEARTBEAT, useValue: { healthy: () => true } satisfies RelayHeartbeat },
  ],
  exports: [RELAY_HEARTBEAT],
})
class OutboxDisabledModule {}
