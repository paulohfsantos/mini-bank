// Integração do worker: Nest standalone de verdade, Postgres real (papel
// mini_banco_worker) e ElasticMQ. As transferências são semeadas com o dono do banco,
// porque o worker (corretamente) não pode inserir em transfers.
import 'reflect-metadata';
import {
  GetQueueAttributesCommand,
  type MessageAttributeValue,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { uuidv7 } from '@mini-banco/database';
import { createTestDatabase, type TestDatabase } from '@mini-banco/database/testing';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { createLogger } from '@mini-banco/observability';
import { MemoryStream } from '@mini-banco/observability/testing';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { WorkerModule } from '../../src/worker.module';
import { cpfFrom } from '../support/cpf';

let db: TestDatabase;
let owner: pg.Pool;
let admin: pg.Client;
let sqs: SQSClient;
let queueUrl: string;
let dlqUrl: string;
let logs: MemoryStream;
let app: INestApplicationContext | undefined;
let cpfSeq = 200_000_000;

beforeEach(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'), { role: 'mini_banco_worker', max: 10 });
  owner = new pg.Pool({ connectionString: db.url, max: 3 });
  owner.on('error', () => undefined); // PRC-AC-06 encerra conexões de propósito
  admin = new pg.Client({ connectionString: inject('pgAdminUrl') });
  await admin.connect();
  sqs = createTestSqsClient(inject('sqsEndpoint'));
  ({ queueUrl, dlqUrl } = await createTestQueues(sqs));
  logs = new MemoryStream();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  sqs.destroy();
  await admin.end();
  await owner.end();
  await db.drop();
});

async function startWorker() {
  const logger = createLogger({ service: 'worker', level: 'debug', destination: logs });
  app = await NestFactory.createApplicationContext(
    WorkerModule.forRoot({
      pool: db.pool,
      sqs,
      queueUrl,
      logger,
      // Long polling curto e backoff de 1 s para os testes não esperarem 20 s / 5 s.
      consumer: { concurrency: 5, waitTimeSeconds: 1, maxMessages: 10 },
      backoff: { baseSeconds: 1, maxSeconds: 2 },
      ownsResources: false,
    }),
    { logger: false },
  );
  return app;
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

interface Seeded {
  transferId: string;
  source: string;
  destination: string;
  amountCents: number;
  completedAt: Date;
}

async function transfer(
  amountCents: number,
  options: { source?: string; destination?: string; at?: Date } = {},
): Promise<Seeded> {
  const source = options.source ?? (await account());
  const destination = options.destination ?? (await account());
  const transferId = uuidv7();
  const completedAt = options.at ?? new Date();
  await owner.query(
    `INSERT INTO transfers (id, source_account_id, destination_account_id, amount_cents, status, correlation_id, created_at)
     VALUES ($1, $2, $3, $4, 'COMPLETED', 'seed', $5)`,
    [transferId, source, destination, amountCents, completedAt],
  );
  return { transferId, source, destination, amountCents, completedAt };
}

function eventFor(t: Seeded, overrides: { data?: object; eventId?: string } = {}) {
  return {
    eventId: overrides.eventId ?? uuidv7(),
    eventType: 'transfer.completed',
    eventVersion: 1,
    occurredAt: t.completedAt.toISOString(),
    correlationId: 'c-body',
    data: {
      transferId: t.transferId,
      sourceAccountId: t.source,
      destinationAccountId: t.destination,
      amountCents: t.amountCents,
      completedAt: t.completedAt.toISOString(),
      ...overrides.data,
    },
  };
}

async function send(body: unknown, attributes: Record<string, string> = {}) {
  const MessageAttributes: Record<string, MessageAttributeValue> = Object.fromEntries(
    Object.entries({ eventType: 'transfer.completed', ...attributes }).map(([k, v]) => [
      k,
      { DataType: 'String', StringValue: v },
    ]),
  );
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
      MessageAttributes,
    }),
  );
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

async function review(transferId: string) {
  const { rows } = await owner.query<{ status: string; reasons: string[]; rule_version: string }>(
    'SELECT status, reasons, rule_version FROM fraud_reviews WHERE transfer_id = $1',
    [transferId],
  );
  return rows[0];
}

// Identificador não vira parâmetro ($1): whitelist de queries fixas (SEC-09).
const COUNT_SQL = {
  fraud_reviews: 'SELECT count(*)::int AS n FROM fraud_reviews',
  notifications: 'SELECT count(*)::int AS n FROM notifications',
  processed_messages: 'SELECT count(*)::int AS n FROM processed_messages',
} as const;

async function countRows(table: keyof typeof COUNT_SQL) {
  const { rows } = await owner.query<{ n: number }>(COUNT_SQL[table]);
  return rows[0]!.n;
}

async function queueDepth(url: string) {
  const { Attributes = {} } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  );
  return (
    Number(Attributes.ApproximateNumberOfMessages ?? 0) +
    Number(Attributes.ApproximateNumberOfMessagesNotVisible ?? 0)
  );
}

const minutesBefore = (base: Date, m: number, s = 0) =>
  new Date(base.getTime() - m * 60_000 - s * 1000);

describe('worker (Postgres + ElasticMQ)', () => {
  it('[PRC-AC-01] 15000 centavos sem histórico: CLEARED, duas notificações, mensagem apagada', async () => {
    const t = await transfer(15_000);
    await startWorker();
    await send(eventFor(t));

    expect(await waitFor(() => review(t.transferId))).toEqual({
      status: 'CLEARED',
      reasons: [],
      rule_version: '2026-11-v1',
    });
    const { rows } = await owner.query<{ type: string; account_id: string; channel: string }>(
      'SELECT type, account_id, channel FROM notifications WHERE transfer_id = $1 ORDER BY type DESC',
      [t.transferId],
    );
    expect(rows).toEqual([
      { type: 'TRANSFER_SENT', account_id: t.source, channel: 'LOG' },
      { type: 'TRANSFER_RECEIVED', account_id: t.destination, channel: 'LOG' },
    ]);
    await waitFor(async () => ((await queueDepth(queueUrl)) === 0 ? true : undefined));
    expect(logs.lines.filter((l) => l.msg === 'notification sent')).toHaveLength(2);
  });

  it('[PRC-AC-02] 1.000.000 → FLAGGED HIGH_AMOUNT; 999.999 → CLEARED', async () => {
    const high = await transfer(1_000_000);
    const below = await transfer(999_999);
    await startWorker();
    await send(eventFor(high));
    await send(eventFor(below));

    expect(await waitFor(() => review(high.transferId))).toMatchObject({
      status: 'FLAGGED',
      reasons: ['HIGH_AMOUNT'],
    });
    expect(await waitFor(() => review(below.transferId))).toMatchObject({ status: 'CLEARED' });
  });

  it('[PRC-AC-03] 4 na janela + a 5ª → HIGH_VELOCITY mesmo processada 1 h depois; 10 min + 1 s antes não conta', async () => {
    // completedAt 1 h no passado: se a janela usasse now(), nada cairia nela.
    const completedAt = new Date(Date.now() - 3_600_000);

    const a = await account();
    for (const m of [9, 6, 3, 1])
      await transfer(100, { source: a, at: minutesBefore(completedAt, m) });
    const fifth = await transfer(100, { source: a, at: completedAt });

    const c = await account();
    for (const m of [6, 3, 1])
      await transfer(100, { source: c, at: minutesBefore(completedAt, m) });
    await transfer(100, { source: c, at: minutesBefore(completedAt, 10, 1) }); // fora
    const outside = await transfer(100, { source: c, at: completedAt });

    await startWorker();
    await send(eventFor(fifth));
    await send(eventFor(outside));

    expect(await waitFor(() => review(fifth.transferId))).toMatchObject({
      status: 'FLAGGED',
      reasons: ['HIGH_VELOCITY'],
    });
    expect(await waitFor(() => review(outside.transferId))).toMatchObject({ status: 'CLEARED' });
  });

  it('[PRC-AC-04] o mesmo evento entregue duas vezes: 1 revisão, 2 notificações, as duas mensagens apagadas', async () => {
    const t = await transfer(15_000);
    const event = eventFor(t);
    await send(event);
    await send(event); // duplicata (ex.: relay caiu entre o envio e a marcação)
    await startWorker();

    await waitFor(async () => ((await queueDepth(queueUrl)) === 0 ? true : undefined));
    expect(await countRows('fraud_reviews')).toBe(1);
    expect(await countRows('notifications')).toBe(2);
    expect(await countRows('processed_messages')).toBe(1);
    expect(logs.lines.some((l) => l.msg === 'duplicate event skipped')).toBe(true);
  });

  it('[PRC-AC-05] corpo {"foo":1} ou JSON inválido: nada gravado, log ERROR, DLQ após 5 recebimentos', async () => {
    await startWorker();
    await send('{"foo":1}');
    await send('isto não é json');

    await waitFor(async () => ((await queueDepth(dlqUrl)) === 2 ? true : undefined), 20_000);
    expect(await queueDepth(queueUrl)).toBe(0);
    expect(await countRows('processed_messages')).toBe(0);
    expect(await countRows('fraud_reviews')).toBe(0);

    const errors = logs.lines.filter((l) => l.level === 'error' && l.kind === 'INVALID_PAYLOAD');
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors[0]?.issues).toBeDefined();

    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: 10,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    expect(new Set(Messages.map((m) => m.Body))).toEqual(new Set(['{"foo":1}', 'isto não é json']));
  });

  it('[PRC-AC-06] Postgres indisponível: mensagem não é apagada, volta com backoff e é processada quando o banco volta', async () => {
    const t = await transfer(15_000);
    const name = new URL(db.url).pathname.slice(1);
    const ident = admin.escapeIdentifier(name);
    const blockSql = `ALTER DATABASE ${ident} WITH ALLOW_CONNECTIONS false`;
    const unblockSql = `ALTER DATABASE ${ident} WITH ALLOW_CONNECTIONS true`;
    await startWorker();

    // "Derruba" o banco: recusa conexões novas e encerra as existentes.
    await admin.query(blockSql);
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [name],
    );
    await send(eventFor(t));

    await waitFor(
      () =>
        Promise.resolve(
          logs.lines.filter((l) => l.msg === 'transient failure; retrying with backoff').length >= 2
            ? true
            : undefined,
        ),
      15_000,
    );
    expect(await queueDepth(queueUrl)).toBe(1); // não foi apagada

    await admin.query(unblockSql);
    expect(await waitFor(() => review(t.transferId), 15_000)).toMatchObject({ status: 'CLEARED' });
    expect(await queueDepth(dlqUrl)).toBe(0); // dentro de 5 recebimentos
    const retries = logs.lines.filter((l) => l.msg === 'transient failure; retrying with backoff');
    expect(retries.map((l) => l.retryInSeconds)).toContain(1);
  });

  it('[PRC-AC-07] todos os logs do processamento trazem o correlationId do attribute e o traceId do traceparent', async () => {
    const t = await transfer(15_000);
    await startWorker();
    await send(eventFor(t), {
      correlationId: 'c-123',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    await waitFor(() => review(t.transferId));
    await waitFor(async () => ((await queueDepth(queueUrl)) === 0 ? true : undefined));

    const processing = logs.lines.filter((l) => l.component !== 'sqs-consumer');
    expect(processing.map((l) => l.msg)).toEqual(
      expect.arrayContaining(['notification sent', 'transfer.completed processed']),
    );
    for (const line of processing) {
      expect(line, String(line.msg)).toMatchObject({
        correlationId: 'c-123',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      });
    }
  });

  it.each([
    ['transferId inexistente', { transferId: '0193a1b2-7c4d-7e5f-8a6b-ffffffffffff' }],
    ['valor divergente', { amountCents: 1 }],
  ])('[PRC-AC-08] %s: nada gravado, log de segurança, DLQ', async (_c, data) => {
    const t = await transfer(15_000);
    await startWorker();
    await send(eventFor(t, { data }));

    await waitFor(async () => ((await queueDepth(dlqUrl)) === 1 ? true : undefined), 20_000);
    expect(await countRows('processed_messages')).toBe(0);
    expect(await countRows('fraud_reviews')).toBe(0);
    expect(await countRows('notifications')).toBe(0);
    expect(logs.lines.find((l) => l.kind === 'TRANSFER_MISMATCH')).toMatchObject({
      level: 'error',
      security: true,
    });
  });

  it('[PERF-19] shutdown cancela o long polling na hora (sem esperar os 20 s)', async () => {
    const logger = createLogger({ service: 'worker', level: 'silent' });
    const worker = await NestFactory.createApplicationContext(
      WorkerModule.forRoot({
        pool: db.pool,
        sqs,
        queueUrl,
        logger,
        consumer: { concurrency: 5, waitTimeSeconds: 20, maxMessages: 10 },
        ownsResources: false,
      }),
      { logger: false },
    );
    await new Promise((r) => setTimeout(r, 300)); // ReceiveMessage pendente
    const startedAt = Date.now();
    await worker.close();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
