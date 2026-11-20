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
import { HealthServer } from './health/health-server';
import {
  type BackoffOptions,
  TransferCompletedHandler,
} from './processing/application/message-handler';
import { ProcessTransferCompletedUseCase } from './processing/application/process-transfer-completed';
import { LogNotifier } from './processing/infrastructure/log-notifier';
import { otelProcessingMetrics } from './processing/infrastructure/otel-processing-metrics';
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
const HEALTH = Symbol('HealthOptions');
const ON_SHUTDOWN = Symbol('OnShutdown');

export interface WorkerDeps {
  pool: Pool;
  sqs: SQSClient;
  queueUrl: string;
  logger: Logger;
  consumer: ConsumerOptions;
  backoff?: BackoffOptions;
  /** main.ts: true (fecha pool e cliente no shutdown). Testes: false. */
  ownsResources: boolean;
  /** OBS-BR-11: porta do health HTTP (0 = livre, testes). Ausente = sem servidor. */
  healthPort?: number;
  /** Último passo do shutdown (main.ts: flush da telemetria, OBS-BR-02). */
  onShutdown?: () => Promise<void>;
}

/** NestJS standalone (sem HTTP): wiring por factories, como na API (ADR-0003). */
@Module({})
export class WorkerModule
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private health: HealthServer | undefined;
  /** Porta efetiva do health HTTP depois do bootstrap (testes usam porta 0). */
  healthPort: number | undefined;

  constructor(
    @Inject(SqsConsumer) private readonly consumer: SqsConsumer,
    @Inject(POOL) private readonly pool: Pool,
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    @Inject(OWNS_RESOURCES) private readonly owns: boolean,
    @Inject(HEALTH) private readonly healthOptions: { port?: number },
    @Inject(ON_SHUTDOWN) private readonly onShutdown: () => Promise<void>,
  ) {}

  static forRoot(deps: WorkerDeps): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: POOL, useValue: deps.pool },
        { provide: SQS_CLIENT, useValue: deps.sqs },
        { provide: OWNS_RESOURCES, useValue: deps.ownsResources },
        {
          provide: HEALTH,
          useValue: deps.healthPort !== undefined ? { port: deps.healthPort } : {},
        },
        { provide: ON_SHUTDOWN, useValue: deps.onShutdown ?? (() => Promise.resolve()) },
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
              new TransferCompletedHandler(
                useCase,
                deps.logger,
                deps.backoff,
                otelProcessingMetrics,
              ),
              deps.logger,
              deps.consumer,
            ),
          inject: [ProcessTransferCompletedUseCase],
        },
      ],
      exports: [ProcessTransferCompletedUseCase],
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    this.consumer.start();
    if (this.healthOptions.port !== undefined) {
      this.health = new HealthServer({
        pool: this.pool,
        consumerHealthy: () => this.consumer.healthy(),
      });
      this.healthPort = await this.health.listen(this.healthOptions.port);
    }
  }

  /** SIGTERM: cancela o long polling e termina o lote antes de fechar o pool (PERF-19). */
  async beforeApplicationShutdown(): Promise<void> {
    await this.health?.close();
    await this.consumer.stop();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.owns) {
      this.sqs.destroy();
      await this.pool.end();
    }
    await this.onShutdown();
  }
}
