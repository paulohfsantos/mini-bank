import {
  type BeforeApplicationShutdown,
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { Database, type Pool } from '@mini-banco/database';
import type { Logger } from '@mini-banco/observability';
import {
  type BackoffOptions,
  TransferCompletedHandler,
} from './processing/application/message-handler';
import { ProcessTransferCompletedUseCase } from './processing/application/process-transfer-completed';
import { LogNotifier } from './processing/infrastructure/log-notifier';
import {
  PgFraudReviews,
  PgNotifications,
  PgProcessedMessages,
  PgTransferReader,
  PgUnitOfWork,
  UuidV7Generator,
} from './processing/infrastructure/pg-repositories';
import { type ConsumerOptions, SqsConsumer } from './processing/infrastructure/sqs-consumer';

const POOL = Symbol('Pool');
const SQS_CLIENT = Symbol('SqsClient');
const OWNS_RESOURCES = Symbol('OwnsResources');

export interface WorkerDeps {
  pool: Pool;
  sqs: SQSClient;
  queueUrl: string;
  logger: Logger;
  consumer: ConsumerOptions;
  backoff?: BackoffOptions;
  /** main.ts: true (fecha pool e cliente no shutdown). Testes: false. */
  ownsResources: boolean;
}

/** NestJS standalone (sem HTTP): wiring por factories, como na API (ADR-0003). */
@Module({})
export class WorkerModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  constructor(
    @Inject(SqsConsumer) private readonly consumer: SqsConsumer,
    @Inject(POOL) private readonly pool: Pool,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(OWNS_RESOURCES) private readonly owns: boolean,
  ) {}

  static forRoot(deps: WorkerDeps): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: POOL, useValue: deps.pool },
        { provide: SQS_CLIENT, useValue: deps.sqs },
        { provide: OWNS_RESOURCES, useValue: deps.ownsResources },
        {
          provide: ProcessTransferCompletedUseCase,
          useFactory: () => {
            const db = new Database(deps.pool);
            return new ProcessTransferCompletedUseCase(
              new PgUnitOfWork(db),
              new UuidV7Generator(),
              new PgProcessedMessages(db),
              new PgTransferReader(db),
              new PgFraudReviews(db),
              new PgNotifications(db),
              new LogNotifier(deps.logger),
            );
          },
        },
        {
          provide: SqsConsumer,
          useFactory: (useCase: ProcessTransferCompletedUseCase) =>
            new SqsConsumer(
              deps.sqs,
              deps.queueUrl,
              new TransferCompletedHandler(useCase, deps.logger, deps.backoff),
              deps.logger,
              deps.consumer,
            ),
          inject: [ProcessTransferCompletedUseCase],
        },
      ],
      exports: [ProcessTransferCompletedUseCase],
    };
  }

  onApplicationBootstrap(): void {
    this.consumer.start();
  }

  /** SIGTERM: cancela o long polling e termina o lote antes de fechar o pool (PERF-19). */
  async beforeApplicationShutdown(): Promise<void> {
    await this.consumer.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.owns) return;
    this.sqs.destroy();
    await this.pool.end();
  }
}
