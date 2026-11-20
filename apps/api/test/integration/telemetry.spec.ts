// Integração: propagação de contexto pelo outbox e métricas do relay (OBS), com Postgres
// real (papel mini_banco_api), ElasticMQ e o SDK do OpenTelemetry em memória.
import { ReceiveMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { TestingModule } from '@nestjs/testing';
import { MESSAGE_ATTRIBUTES } from '@mini-banco/contracts';
import { Database } from '@mini-banco/database';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { appMetrics } from '@mini-banco/observability';
import {
  startTestTelemetry,
  type TestTelemetry,
  withServerSpan,
} from '@mini-banco/observability/testing';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { CreateAccountUseCase } from '../../src/modules/accounts/application/create-account.use-case';
import { OutboxRelay } from '../../src/modules/outbox/application/outbox-relay';
import { PgOutboxStore } from '../../src/modules/outbox/infrastructure/pg-outbox.store';
import { SqsEventPublisher } from '../../src/modules/outbox/infrastructure/sqs-event.publisher';
import { TransferFundsUseCase } from '../../src/modules/transfers/application/transfer-funds.use-case';
import { compileModule, openTestDb, type TestDb } from '../support/app';
import { nextCpf } from '../support/cpf';

const T = '4bf92f3577b34da6a3ce929d0e0e4736';
const S = '00f067aa0ba902b7';

let t: TestDb;
let mod: TestingModule;
let telemetry: TestTelemetry;
let sqs: SQSClient;
let queueUrl: string;
let seq = 0;

beforeEach(async () => {
  telemetry = startTestTelemetry('api');
  t = await openTestDb();
  mod = await compileModule(t);
  sqs = createTestSqsClient(inject('sqsEndpoint'));
  ({ queueUrl } = await createTestQueues(sqs));
});

afterEach(async () => {
  sqs.destroy();
  await mod.close();
  await t.close();
  await telemetry.shutdown();
});

async function transfer() {
  const accounts = mod.get(CreateAccountUseCase);
  const a = await accounts.execute({
    holderName: 'A',
    document: nextCpf(),
    initialBalanceCents: 100_000,
  });
  const b = await accounts.execute({
    holderName: 'B',
    document: nextCpf(),
    initialBalanceCents: 0,
  });
  const { body } = await mod.get(TransferFundsUseCase).execute({
    clientId: 'web',
    idempotencyKey: `obs-${++seq}`,
    sourceAccountId: a.id,
    destinationAccountId: b.id,
    amountCents: 1_500,
    correlationId: `c-obs-${seq}`,
  });
  return body;
}

async function outboxTraceparent(transferId: string): Promise<string | null> {
  const { rows } = await t.owner.query<{ traceparent: string | null }>(
    'SELECT traceparent FROM outbox WHERE aggregate_id = $1',
    [transferId],
  );
  return rows[0]?.traceparent ?? null;
}

function relay() {
  const store = new PgOutboxStore(new Database(t.db.pool));
  return { store, relay: new OutboxRelay(store, new SqsEventPublisher(sqs, queueUrl)) };
}

describe('traceparent no outbox', () => {
  it('[OBS-AC-03] grava o traceparent do span ativo da requisição (não o do cliente)', async () => {
    // O span de servidor do http (simulado aqui) é filho do traceparent do cliente.
    let serverSpanId = '';
    const body = await withServerSpan(
      'POST /v1/transfers',
      { traceparent: `00-${T}-${S}-01` },
      async (span) => {
        serverSpanId = span.spanContext().spanId;
        return transfer();
      },
    );
    const traceparent = await outboxTraceparent(body.id);
    expect(traceparent).toBe(`00-${T}-${serverSpanId}-01`);
    expect(serverSpanId).not.toBe(S);
  });

  it('[OBS-AC-03] sem span ativo (SDK desligado) a coluna fica NULL e a transferência funciona', async () => {
    await telemetry.shutdown();
    const body = await transfer();
    expect(body.status).toBe('COMPLETED');
    expect(await outboxTraceparent(body.id)).toBeNull();
    telemetry = startTestTelemetry('api');
  });
});

describe('relay e contexto', () => {
  it('[OBS-AC-02] a mensagem leva o traceparent gravado e o span outbox publish tem link para ele', async () => {
    const original = `00-${T}-${S}-01`;
    await t.owner.query(
      `INSERT INTO outbox (id, aggregate_id, event_type, payload, correlation_id, traceparent)
       VALUES (gen_random_uuid(), gen_random_uuid(), 'transfer.completed', '{}'::jsonb, 'c-1', $1)`,
      [original],
    );
    const { relay: r } = relay();
    expect((await r.runOnce()).published).toBe(1);

    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MessageAttributeNames: ['All'] }),
    );
    expect(Messages?.[0]?.MessageAttributes?.[MESSAGE_ATTRIBUTES.traceparent]?.StringValue).toBe(
      original,
    );

    const publish = (await telemetry.spans()).find((s) => s.name === 'outbox publish');
    expect(publish?.parentSpanContext).toBeUndefined();
    expect(publish?.links.map((l) => l.context.traceId)).toEqual([T]);
    expect(publish?.attributes['messaging.batch.message_count']).toBe(1);
  });
});

describe('métricas do outbox', () => {
  it('[OBS-AC-08] outbox_publish_lag_ms por evento publicado e outbox_pending com o backlog', async () => {
    await transfer();
    await transfer();
    const { store, relay: r } = relay();
    const stop = appMetrics.observeOutboxPending(() => store.countPending(1_000));

    expect(await telemetry.value('outbox_pending')).toBe(2);
    expect((await r.runOnce()).published).toBe(2);
    expect(await telemetry.value('outbox_publish_lag_ms')).toBe(2);
    expect(await telemetry.value('outbox_pending')).toBe(0);
    stop();
  });
});
