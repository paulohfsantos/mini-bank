// Integração do worker com o SDK do OpenTelemetry em memória: span de processamento ligado
// ao trace da requisição, métricas e health HTTP (OBS). Postgres real (mini_banco_worker) e
// ElasticMQ.
import 'reflect-metadata';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPool, uuidv7 } from '@mini-banco/database';
import { createTestDatabase, type TestDatabase } from '@mini-banco/database/testing';
import { createSqsClient } from '@mini-banco/messaging';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { createLogger } from '@mini-banco/observability';
import {
  MemoryStream,
  startTestTelemetry,
  type TestTelemetry,
} from '@mini-banco/observability/testing';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { WorkerModule } from '../../src/worker.module';
import { cpfFrom } from '../support/cpf';

const T = '4bf92f3577b34da6a3ce929d0e0e4736';
const S = '00f067aa0ba902b7';

let db: TestDatabase;
let owner: pg.Pool;
let sqs: SQSClient;
let queueUrl: string;
let logs: MemoryStream;
let telemetry: TestTelemetry;
let app: INestApplicationContext | undefined;
let cpfSeq = 300_000_000;

beforeEach(async () => {
  telemetry = startTestTelemetry('worker');
  db = await createTestDatabase(inject('pgAdminUrl'), { role: 'mini_banco_worker', max: 10 });
  owner = new pg.Pool({ connectionString: db.url, max: 3 });
  sqs = createTestSqsClient(inject('sqsEndpoint'));
  ({ queueUrl } = await createTestQueues(sqs));
  logs = new MemoryStream();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  sqs.destroy();
  await owner.end();
  await db.drop();
  await telemetry.shutdown();
});

async function startWorker(overrides: { pool?: pg.Pool; sqs?: SQSClient } = {}) {
  app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot({
      pool: overrides.pool ?? db.pool,
      sqs: overrides.sqs ?? sqs,
      queueUrl,
      logger: createLogger({ service: 'worker', level: 'info', destination: logs }),
      consumer: { concurrency: 5, waitTimeSeconds: 1, maxMessages: 10 },
      backoff: { baseSeconds: 1, maxSeconds: 2 },
      ownsResources: false,
      healthPort: 0,
    }),
    { logger: false },
  );
  return app;
}

function healthUrl(path: string): string {
  const port = app?.get(WorkerModule).healthPort;
  return `http://127.0.0.1:${port}${path}`;
}

async function account(): Promise<string> {
  const id = uuidv7();
  cpfSeq += 7919;
  await owner.query(
    `INSERT INTO accounts (id, holder_name, document, balance_cents) VALUES ($1, 'T', $2, 0)`,
    [id, cpfFrom(String(cpfSeq).slice(-9))],
  );
  return id;
}

/** Transferência semeada + evento correspondente na fila. */
async function sendTransfer(amountCents: number, attributes: Record<string, string> = {}) {
  const [source, destination] = [await account(), await account()];
  const transferId = uuidv7();
  const completedAt = new Date();
  await owner.query(
    `INSERT INTO transfers (id, source_account_id, destination_account_id, amount_cents, status, correlation_id, created_at)
     VALUES ($1, $2, $3, $4, 'COMPLETED', 'seed', $5)`,
    [transferId, source, destination, amountCents, completedAt],
  );
  const event = {
    eventId: uuidv7(),
    eventType: 'transfer.completed',
    eventVersion: 1,
    occurredAt: completedAt.toISOString(),
    correlationId: 'c-obs-w',
    data: {
      transferId,
      sourceAccountId: source,
      destinationAccountId: destination,
      amountCents,
      completedAt: completedAt.toISOString(),
    },
  };
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
      MessageAttributes: Object.fromEntries(
        Object.entries({
          eventType: 'transfer.completed',
          correlationId: 'c-obs-w',
          ...attributes,
        }).map(([k, v]) => [k, { DataType: 'String', StringValue: v }]),
      ),
    }),
  );
  return event;
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timeout esperando condição');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const processSpans = async () =>
  (await telemetry.spans()).filter((s) => s.name === 'transfer.completed process');

describe('span de processamento', () => {
  it('[OBS-AC-04] continua o trace do traceparent e os logs trazem o mesmo traceId', async () => {
    await startWorker();
    const event = await sendTransfer(15_000, { traceparent: `00-${T}-${S}-01` });
    const [span] = await waitFor(async () => {
      const spans = await processSpans();
      return spans.length > 0 ? spans : undefined;
    });

    expect(span?.spanContext().traceId).toBe(T);
    expect(span?.parentSpanContext?.spanId).toBe(S);
    expect(span?.attributes['app.correlation_id']).toBe('c-obs-w');
    expect(span?.attributes['app.decision']).toBe('delete');

    const processed = logs.lines.find((l) => l.msg === 'transfer.completed processed');
    expect(processed).toMatchObject({
      transferId: event.data.transferId,
      correlationId: 'c-obs-w',
      traceId: T,
      spanId: span?.spanContext().spanId,
    });
  });

  it.each([
    ['ausente', {}],
    ['malformado', { traceparent: 'lixo' }],
  ])('[OBS-AC-04] traceparent %s → trace novo e mensagem processada', async (_c, attrs) => {
    await startWorker();
    await sendTransfer(15_000, attrs);
    const [span] = await waitFor(async () => {
      const spans = await processSpans();
      return spans.length > 0 ? spans : undefined;
    });
    expect(span?.parentSpanContext).toBeUndefined();
    expect(span?.attributes['app.decision']).toBe('delete');
  });
});

describe('métricas do worker', () => {
  it('[OBS-AC-08] worker_processing_ms{processed} por mensagem e fraud_flagged{HIGH_AMOUNT}', async () => {
    await startWorker();
    await sendTransfer(15_000);
    await sendTransfer(1_000_000); // R$ 10.000,00: HIGH_AMOUNT
    await waitFor(async () =>
      (await telemetry.value('worker_processing_ms', { outcome: 'processed' })) === 2
        ? true
        : undefined,
    );
    expect(await telemetry.value('fraud_flagged', { rule: 'HIGH_AMOUNT' })).toBe(1);
    expect(await telemetry.value('fraud_flagged', { rule: 'HIGH_VELOCITY' })).toBe(0);
  });
});

describe('health HTTP do worker', () => {
  it('[OBS-AC-12] live e ready 200 com o worker rodando', async () => {
    await startWorker();
    for (const path of ['/health/live', '/health/ready']) {
      const res = await fetch(healthUrl(path));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    }
  });

  it('[OBS-AC-12] Postgres indisponível → ready 503, live 200', async () => {
    const deadPool = createPool({
      connectionString: 'postgres://x:y@127.0.0.1:1/none',
      applicationName: 'test',
      max: 1,
      connectionTimeoutMillis: 500,
    });
    await startWorker({ pool: deadPool });
    expect((await fetch(healthUrl('/health/ready'))).status).toBe(503);
    expect((await fetch(healthUrl('/health/live'))).status).toBe(200);
    await app?.close();
    app = undefined;
    await deadPool.end();
  });

  it('[OBS-AC-12] ReceiveMessage falhando → ready 503, live 200', async () => {
    const deadSqs = createSqsClient({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:1',
      requestTimeoutMs: 500,
      maxAttempts: 1,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await startWorker({ sqs: deadSqs });
    await waitFor(async () =>
      (await fetch(healthUrl('/health/ready'))).status === 503 ? true : undefined,
    );
    expect((await fetch(healthUrl('/health/live'))).status).toBe(200);
    await app?.close();
    app = undefined;
    deadSqs.destroy();
  });
});
