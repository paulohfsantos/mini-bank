import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createPool } from '@mini-banco/database';
import { createSqsClient } from '@mini-banco/messaging';
import { createLogger, shutdownTelemetry } from '@mini-banco/observability';
import { loadConfig } from './config';
import { NestPinoLogger } from './nest-logger';
import { WorkerModule } from './worker.module';

const config = loadConfig(process.env);
const logger = createLogger({ service: 'worker', level: config.logLevel });

const pool = createPool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  ssl: config.database.ssl ? { rejectUnauthorized: true } : false,
  applicationName: 'worker',
  max: config.database.max,
  onIdleError: (error) =>
    logger.warn({ err: { message: error.message } }, 'idle database connection lost'),
});

// Timeout por requisição acima dos 20 s do long polling.
const sqs = createSqsClient({
  region: config.sqs.region,
  ...(config.sqs.endpoint ? { endpoint: config.sqs.endpoint } : {}),
  requestTimeoutMs: 25_000,
});

const app = await NestFactory.createApplicationContext(
  WorkerModule.forRoot({
    pool,
    sqs,
    queueUrl: config.sqs.queueUrl,
    logger,
    consumer: { concurrency: config.concurrency, waitTimeSeconds: 20, maxMessages: 10 },
    ownsResources: true,
    healthPort: config.healthPort,
    // SDK iniciado por `--import @mini-banco/observability/register` (OBS-BR-01).
    onShutdown: () => shutdownTelemetry(),
  }),
  { logger: new NestPinoLogger(logger), abortOnError: false },
);
app.enableShutdownHooks();
logger.info(
  { queue: config.sqs.queueUrl.split('/').at(-1), healthPort: config.healthPort },
  'worker running',
);
