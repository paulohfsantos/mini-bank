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
import type { Logger } from '@mini-banco/observability';
import type { AppConfig } from '../../config';
import { Cleanup } from './application/cleanup';
import { OutboxRelay } from './application/outbox-relay';
import { PgCleanupStore, PgOutboxStore } from './infrastructure/pg-outbox.store';
import { RelayRunner } from './infrastructure/relay-runner';
import { SqsEventPublisher } from './infrastructure/sqs-event.publisher';

const SQS_CLIENT = Symbol('SqsClient');

/**
 * Relay do outbox dentro do processo da API (ADR-0006). Só é montado com
 * OUTBOX_RELAY_ENABLED=true; desligado, a API apenas grava no outbox.
 */
@Module({})
export class OutboxModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    @Inject(RelayRunner) private readonly runner: RelayRunner,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
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
          provide: RelayRunner,
          useFactory: (db: Database, sqs: SQSClient) =>
            new RelayRunner(
              new OutboxRelay(new PgOutboxStore(db), new SqsEventPublisher(sqs, queueUrl)),
              new Cleanup(new PgCleanupStore(db)),
              logger,
            ),
          inject: [Database, SQS_CLIENT],
        },
      ],
    };
  }

  onApplicationBootstrap(): void {
    this.runner.start();
  }

  /** Antes do DatabaseModule fechar o pool (onApplicationShutdown): PERF-22. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.runner.stop();
  }

  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}

@Module({})
class OutboxDisabledModule {}
