import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY, httpServer, openTestDb, startApp, type TestDb } from '../support/app';
import { bodyOf, expectContract } from '../support/contract';
import { nextCpf } from '../support/cpf';

let t: TestDb;
let app: INestApplication;
let http: ReturnType<typeof request.agent>;
let keySeq = 0;
const PATH = '/v1/accounts/{accountId}/statement';

beforeAll(async () => {
  t = await openTestDb();
  app = await startApp(t);
  http = request.agent(httpServer(app)).set('x-api-key', API_KEY);
});

afterAll(async () => {
  await app.close();
  await t.close();
});

async function account(cents: number): Promise<string> {
  const res = await http
    .post('/v1/accounts')
    .send({ holderName: 'T', document: nextCpf(), initialBalanceCents: cents });
  return bodyOf(res).id;
}

async function transfer(source: string, destination: string, amountCents: number) {
  const res = await http
    .post('/v1/transfers')
    .set('idempotency-key', `stm-${++keySeq}`)
    .send({ sourceAccountId: source, destinationAccountId: destination, amountCents });
  expect(res.status).toBe(201);
  return bodyOf(res).id;
}

describe('GET /v1/accounts/{accountId}/statement', () => {
  it('[STM-AC-01] ordem decrescente, OPENING por último, saldos consistentes', async () => {
    const a = await account(10_000);
    const b = await account(10_000);
    await transfer(a, b, 1000);
    await transfer(b, a, 300);
    await transfer(a, b, 200);
    await transfer(b, a, 50);
    await transfer(a, b, 10);

    const res = await http.get(`/v1/accounts/${a}/statement`);
    expectContract(res, 'GET', PATH);
    const items = bodyOf(res).items;
    expect(items).toHaveLength(6);
    expect(items.at(-1)).toMatchObject({
      type: 'OPENING',
      amountCents: 10_000,
      balanceAfterCents: 10_000,
    });

    // Do mais antigo para o mais recente, cada saldo = anterior ± valor.
    const chronological = [...items].reverse();
    for (let i = 1; i < chronological.length; i++) {
      const prev = chronological[i - 1]!;
      const cur = chronological[i]!;
      const delta = cur.type === 'DEBIT' ? -cur.amountCents : cur.amountCents;
      expect(cur.balanceAfterCents).toBe(prev.balanceAfterCents + delta);
    }
    expect(items[0]!.balanceAfterCents).toBe(10_000 - 1000 + 300 - 200 + 50 - 10);
  });

  it('[STM-AC-02] 45 lançamentos com limit=20 → páginas de 20, 20 e 5; padrão 20; limites inválidos → 400', async () => {
    const a = await account(1_000_000);
    const b = await account(0);
    for (let i = 0; i < 44; i++) await transfer(a, b, 1); // + OPENING = 45

    const sizes: number[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      const query: Record<string, string> = { limit: '20', ...(cursor ? { cursor } : {}) };
      const res = await http.get(`/v1/accounts/${a}/statement`).query(query);
      expectContract(res, 'GET', PATH);
      sizes.push(bodyOf(res).items.length);
      cursor = bodyOf(res).nextCursor;
      cursors.push(cursor);
    } while (cursor);
    expect(sizes).toEqual([20, 20, 5]);
    expect(cursors.map((c) => c === null)).toEqual([false, false, true]);

    const defaultPage = await http.get(`/v1/accounts/${a}/statement`);
    expect(bodyOf(defaultPage).items).toHaveLength(20);

    for (const limit of ['0', '101']) {
      const res = await http.get(`/v1/accounts/${a}/statement`).query({ limit });
      expectContract(res, 'GET', PATH);
      expect(res.status).toBe(400);
      expect(bodyOf(res).code).toBe('VALIDATION_ERROR');
    }
  });

  it.each([
    ['não base64url', '!!!'],
    ['JSON fora do formato', Buffer.from('{"t":"x"}').toString('base64url')],
    ['texto qualquer', Buffer.from('oi').toString('base64url')],
  ])('[STM-AC-03] cursor %s → 400 INVALID_CURSOR', async (_c, cursor) => {
    const a = await account(0);
    const res = await http.get(`/v1/accounts/${a}/statement`).query({ cursor });
    expectContract(res, 'GET', PATH);
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('INVALID_CURSOR');
  });

  it('[STM-AC-04] conta inexistente → 404 ACCOUNT_NOT_FOUND, não página vazia', async () => {
    const res = await http.get('/v1/accounts/0193a1b2-7c4d-7e5f-8a6b-999999999999/statement');
    expectContract(res, 'GET', PATH);
    expect(res.status).toBe(404);
    expect(bodyOf(res).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('[STM-AC-06] DEBIT em A e CREDIT em B com contraparte e mesmo transferId', async () => {
    const a = await account(5000);
    const b = await account(0);
    const transferId = await transfer(a, b, 1234);

    const [sa, sb] = await Promise.all([
      http.get(`/v1/accounts/${a}/statement`),
      http.get(`/v1/accounts/${b}/statement`),
    ]);
    expect(bodyOf(sa).items[0]).toMatchObject({
      type: 'DEBIT',
      amountCents: 1234,
      transferId,
      counterpartyAccountId: b,
    });
    expect(bodyOf(sb).items[0]).toMatchObject({
      type: 'CREDIT',
      amountCents: 1234,
      transferId,
      counterpartyAccountId: a,
    });
    expect(bodyOf(sa).items.at(-1)).toMatchObject({
      transferId: null,
      counterpartyAccountId: null,
    });
  });
});
