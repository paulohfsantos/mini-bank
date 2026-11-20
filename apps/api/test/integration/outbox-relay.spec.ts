// Integração: relay do outbox com Postgres real (papel mini_banco_api) e ElasticMQ.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { TestingModule } from '@nestjs/testing';
import { SPECS_DIR } from '@mini-banco/contracts/testing';
import { Database } from '@mini-banco/database';
import { createSqsClient } from '@mini-banco/messaging';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { createLogger } from '@mini-banco/observability';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { CreateAccountUseCase } from '../../src/modules/accounts/application/create-account.use-case';
import { Cleanup } from '../../src/modules/outbox/application/cleanup';
import { OutboxRelay } from '../../src/modules/outbox/application/outbox-relay';
import type {
  EventPublisher,
  OutboxStore,
  PendingEvent,
} from '../../src/modules/outbox/application/ports';
import {
  PgCleanupStore,
  PgOutboxStore,
} from '../../src/modules/outbox/infrastructure/pg-outbox.store';
import { RelayRunner } from '../../src/modules/outbox/infrastructure/relay-runner';
import { SqsEventPublisher } from '../../src/modules/outbox/infrastructure/sqs-event.publisher';
import { TransferFundsUseCase } from '../../src/modules/transfers/application/transfer-funds.use-case';
import { compileModule, openTestDb, type TestDb } from '../support/app';
import { nextCpf } from '../support/cpf';

let t: TestDb;
let mod: TestingModule;
let db: Database;
let sqs: SQSClient;
let queueUrl: string;
let seq = 0;

beforeEach(async () => {
  t = await openTestDb({ max: 20 });
  mod = await compileModule(t);
  db = new Database(t.db.pool);
  sqs = createTestSqsClient(inject('sqsEndpoint'));
  ({ queueUrl } = await createTestQueues(sqs));
});

afterEach(async () => {
  sqs.destroy();
  await mod.close();
  await t.close();
});

const silent = createLogger({ service: 'test', level: 'silent' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function completedTransfer(amountCents = 1500, correlationId = `c-${++seq}`) {
  const accounts = mod.get(CreateAccountUseCase);
  const a = await accounts.execute({
    holderName: 'A',
    document: nextCpf(),
    initialBalanceCents: 1_000_000,
  });
  const b = await accounts.execute({
    holderName: 'B',
    document: nextCpf(),
    initialBalanceCents: 0,
  });
  const { body } = await mod.get(TransferFundsUseCase).execute({
    clientId: 'web',
    idempotencyKey: `obx-${++seq}`,
    sourceAccountId: a.id,
    destinationAccountId: b.id,
    amountCents,
    correlationId,
  });
  return body;
}

/** Linhas sintéticas no outbox (OBX-AC-03 precisa de 100 de uma vez). */
async function insertPending(count: number) {
  await t.owner.query(
    `INSERT INTO outbox (id, aggregate_id, event_type, payload, correlation_id, created_at)
     SELECT gen_random_uuid(), gen_random_uuid(), 'transfer.completed',
            jsonb_build_object('n', g), 'c-' || g, now() - (1000 - g) * interval '1 ms'
       FROM generate_series(1, $1::int) AS g`,
    [count],
  );
}

async function outboxRows() {
  const { rows } = await t.owner.query<{
    id: string;
    published_at: Date | null;
    attempts: number;
    last_error: string | null;
  }>('SELECT id, published_at, attempts, last_error FROM outbox ORDER BY created_at');
  return rows;
}

async function receiveAll(expected: number, timeoutMs = 10_000) {
  const messages: { body: string; attributes: Record<string, string | undefined> }[] = [];
  const deadline = Date.now() + timeoutMs;
  while (messages.length < expected && Date.now() < deadline) {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        MessageAttributeNames: ['All'],
      }),
    );
    for (const m of Messages) {
      messages.push({
        body: m.Body ?? '',
        attributes: Object.fromEntries(
          Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [k, v.StringValue]),
        ),
      });
      await sqs.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }),
      );
    }
  }
  return messages;
}

const relay = (
  publisher: EventPublisher,
  claimTtlMs = 30_000,
  store: OutboxStore = new PgOutboxStore(db),
) => new OutboxRelay(store, publisher, { batchSize: 10, claimTtlMs });

const publisher = () => new SqsEventPublisher(sqs, queueUrl);

async function drain(r: OutboxRelay, maxCycles = 50) {
  for (let i = 0; i < maxCycles; i++) {
    const { claimed } = await r.runOnce();
    if (claimed === 0) return;
  }
}

describe('OutboxRelay (Postgres + ElasticMQ)', () => {
  it('[OBX-AC-01] transferência concluída é publicada em até 5 s com corpo e attributes do contrato', async () => {
    const transfer = await completedTransfer(1500, 'c-obx-01');
    const runner = new RelayRunner(
      relay(publisher()),
      new Cleanup(new PgCleanupStore(db)),
      silent,
      {
        intervalMs: 200,
        cleanupIntervalMs: 1e9,
      },
    );
    const startedAt = Date.now();
    runner.start();
    try {
      const [message] = await receiveAll(1, 5_000);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(message).toBeDefined();

      const schema = JSON.parse(
        readFileSync(resolve(SPECS_DIR, 'events/transfer.completed.v1.schema.json'), 'utf8'),
      ) as object;
      const ajv = new Ajv2020({ allErrors: true });
      addFormats(ajv);
      const body = JSON.parse(message!.body) as { data: { transferId: string } };
      expect(ajv.validate(schema, body), JSON.stringify(ajv.errors)).toBe(true);
      expect(body.data.transferId).toBe(transfer.id);
      expect(message!.attributes).toMatchObject({
        eventType: 'transfer.completed',
        correlationId: 'c-obx-01',
      });
    } finally {
      await runner.stop();
    }
    const [row] = await outboxRows();
    expect(row?.published_at).toBeInstanceOf(Date);
  });

  it('[OBX-AC-02] fila fora do ar: linhas pendentes com attempts crescendo e last_error; ao voltar, todas publicadas', async () => {
    await completedTransfer();
    await completedTransfer();
    await completedTransfer();

    // Endpoint que recusa conexão: equivale ao SQS indisponível.
    const down = createSqsClient({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:1',
      requestTimeoutMs: 500,
      maxAttempts: 1,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    const broken = relay(new SqsEventPublisher(down, queueUrl), 50);
    for (let i = 0; i < 3; i++) {
      await broken.runOnce();
      await sleep(80); // claim de 50 ms expira
    }
    down.destroy();

    const pending = await outboxRows();
    expect(pending).toHaveLength(3);
    for (const row of pending) {
      expect(row.published_at).toBeNull();
      expect(row.attempts).toBe(3);
      expect(row.last_error).toBeTruthy();
    }

    await sleep(80);
    await drain(relay(publisher(), 50));
    expect((await outboxRows()).every((r) => r.published_at !== null)).toBe(true);
    expect(await receiveAll(3)).toHaveLength(3);
  });

  it('[OBX-AC-03] dois relays sobre 100 linhas: nenhuma reivindicada pelos dois, as 100 publicadas', async () => {
    await insertPending(100);
    const claimedBy = new Map<string, number>();
    const tracking = (relayId: number): OutboxStore => {
      const store = new PgOutboxStore(new Database(t.db.pool));
      return {
        claim: async (limit, ttl) => {
          const events = await store.claim(limit, ttl);
          for (const e of events) {
            expect(claimedBy.get(e.id), `linha ${e.id} reivindicada pelos dois`).toBeUndefined();
            claimedBy.set(e.id, relayId);
          }
          return events;
        },
        markPublished: (ids) => store.markPublished(ids),
        markFailed: (f) => store.markFailed(f),
      };
    };
    // Envio lento faz os ciclos das duas instâncias se sobreporem de verdade.
    const slow = (inner: EventPublisher): EventPublisher => ({
      publish: async (events) => {
        await sleep(30);
        return inner.publish(events);
      },
    });

    await Promise.all([
      drain(relay(slow(publisher()), 30_000, tracking(1))),
      drain(relay(slow(publisher()), 30_000, tracking(2))),
    ]);

    expect(claimedBy.size).toBe(100);
    expect(new Set(claimedBy.values())).toEqual(new Set([1, 2])); // os dois trabalharam
    expect((await outboxRows()).every((r) => r.published_at !== null && r.attempts === 1)).toBe(
      true,
    );
    const messages = await receiveAll(100);
    expect(new Set(messages.map((m) => m.body)).size).toBe(100);
  });

  it('[OBX-AC-04] SQS lento (10 s) não segura transação nem lock no outbox; transferências seguem rápidas', async () => {
    await completedTransfer();
    let sending = false;
    const slowSqs: EventPublisher = {
      publish: async (events: readonly PendingEvent[]) => {
        sending = true;
        await sleep(10_000);
        sending = false;
        return { published: events.map((e) => e.id), failed: [] };
      },
    };
    const cycle = relay(slowSqs).runOnce();
    while (!sending) await sleep(10);

    const { rows: idle } = await t.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND state LIKE 'idle in transaction%'`,
    );
    expect(idle[0]?.n).toBe(0);
    const { rows: locks } = await t.owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks
        WHERE relation = 'outbox'::regclass AND pid <> pg_backend_pid()`,
    );
    expect(locks[0]?.n).toBe(0);

    // TRF-NFR-01 (p95 < 300 ms): com o relay "pendurado", cada transferência continua rápida.
    for (let i = 0; i < 5; i++) {
      const startedAt = performance.now();
      await completedTransfer();
      expect(performance.now() - startedAt).toBeLessThan(300);
    }
    expect(sending).toBe(true); // ainda dentro dos 10 s
    await cycle;
  });

  it('[OBX-AC-05] relay cai depois do claim: quando o claim expira, outro ciclo publica as mesmas linhas', async () => {
    await completedTransfer();
    await completedTransfer();
    // "Relay que morreu": reivindicou e nunca enviou.
    const dead = await new PgOutboxStore(db).claim(10, 300);
    expect(dead).toHaveLength(2);

    const survivor = relay(publisher(), 300);
    expect((await survivor.runOnce()).claimed).toBe(0); // claim ainda válido
    await sleep(350);
    const result = await survivor.runOnce();

    expect(result).toMatchObject({ claimed: 2, published: 2 });
    const published = (await outboxRows()).filter((r) => r.published_at).map((r) => r.id);
    expect(new Set(published)).toEqual(new Set(dead.map((e) => e.id)));
    expect((await outboxRows()).map((r) => r.attempts)).toEqual([2, 2]);
  });

  it('at-least-once: envio ok mas marcação perdida (crash) → o mesmo evento é publicado de novo', async () => {
    await completedTransfer();
    const store = new PgOutboxStore(db);
    const crashing: OutboxStore = {
      claim: (l, ttl) => store.claim(l, ttl),
      markPublished: () => Promise.reject(new Error('processo morreu')),
      markFailed: (f) => store.markFailed(f),
    };
    await expect(relay(publisher(), 100, crashing).runOnce()).rejects.toThrow('processo morreu');
    await sleep(150);
    await drain(relay(publisher(), 100));

    const messages = await receiveAll(2);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.body).toBe(messages[1]!.body); // duplicado: o worker deduplica (PRC-AC-04)
  });
});

describe('limpeza', () => {
  it('[PERF-12] apaga outbox publicado há mais de 7 dias e chaves expiradas, em lotes; mantém o resto', async () => {
    await insertPending(5);
    await t.owner.query(`
      UPDATE outbox SET published_at = now() - interval '8 days'
       WHERE id IN (SELECT id FROM outbox ORDER BY created_at LIMIT 3)`);
    await t.owner.query(`
      UPDATE outbox SET published_at = now() - interval '1 day'
       WHERE id IN (SELECT id FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 1)`);
    await t.owner.query(
      `INSERT INTO idempotency_keys (client_id, key, request_hash, expires_at)
       SELECT 'web', 'k' || g, repeat('0', 64),
              CASE WHEN g <= 4 THEN now() - interval '1 minute' ELSE now() + interval '1 day' END
         FROM generate_series(1, 6) AS g`,
    );

    const result = await new Cleanup(new PgCleanupStore(db), {
      batchSize: 2,
      maxBatches: 50,
      outboxRetentionDays: 7,
    }).run();

    expect(result).toEqual({ outbox: 3, idempotencyKeys: 4 });
    const { rows } = await t.owner.query<{ outbox: number; keys: number }>(
      `SELECT (SELECT count(*)::int FROM outbox) AS outbox,
              (SELECT count(*)::int FROM idempotency_keys) AS keys`,
    );
    expect(rows[0]).toEqual({ outbox: 2, keys: 2 });
  });
});
