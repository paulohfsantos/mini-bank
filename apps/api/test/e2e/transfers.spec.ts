import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API_KEY,
  httpServer,
  openTestDb,
  OTHER_API_KEY,
  startApp,
  type TestDb,
} from '../support/app';
import { bodyOf, expectContract } from '../support/contract';
import { nextCpf } from '../support/cpf';

let t: TestDb;
let app: INestApplication;
let http: ReturnType<typeof request.agent>;
let keySeq = 0;

beforeAll(async () => {
  t = await openTestDb();
  app = await startApp(t);
  http = request.agent(httpServer(app)).set('x-api-key', API_KEY);
});

afterAll(async () => {
  await app.close();
  await t.close();
});

async function account(initialBalanceCents: number): Promise<string> {
  const res = await http
    .post('/v1/accounts')
    .send({ holderName: 'Teste', document: nextCpf(), initialBalanceCents });
  expect(res.status).toBe(201);
  return bodyOf(res).id;
}

function post(body: object, key: string | null = `e2e-${++keySeq}`) {
  const req = http.post('/v1/transfers');
  if (key !== null) req.set('idempotency-key', key);
  return req.send(body);
}

const balance = async (id: string) => bodyOf(await http.get(`/v1/accounts/${id}`)).balanceCents;

describe('POST /v1/transfers', () => {
  it('[TRF-AC-01] transferência válida: 201, Location, saldos e lançamentos', async () => {
    const a = await account(100_000);
    const b = await account(0);
    const res = await post({ sourceAccountId: a, destinationAccountId: b, amountCents: 15_000 });

    expectContract(res, 'POST', '/v1/transfers');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'COMPLETED', amountCents: 15_000 });
    expect(res.headers.location).toBe(`/v1/transfers/${bodyOf(res).id}`);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await balance(a)).toBe(85_000);
    expect(await balance(b)).toBe(15_000);

    const { rows } = await t.owner.query(
      `SELECT account_id, type, amount_cents::int, balance_after_cents::int
         FROM ledger_entries WHERE transfer_id = $1 ORDER BY type DESC`,
      [bodyOf(res).id],
    );
    expect(rows).toEqual([
      { account_id: a, type: 'DEBIT', amount_cents: 15_000, balance_after_cents: 85_000 },
      { account_id: b, type: 'CREDIT', amount_cents: 15_000, balance_after_cents: 15_000 },
    ]);
  });

  it('[TRF-AC-02] saldo insuficiente → 422 INSUFFICIENT_FUNDS', async () => {
    const a = await account(1000);
    const b = await account(0);
    const res = await post({ sourceAccountId: a, destinationAccountId: b, amountCents: 1001 });
    expectContract(res, 'POST', '/v1/transfers');
    expect(res.status).toBe(422);
    expect(bodyOf(res).code).toBe('INSUFFICIENT_FUNDS');
    expect(await balance(a)).toBe(1000);
  });

  it('[TRF-AC-03] sem Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const a = await account(1000);
    const b = await account(0);
    const res = await post({ sourceAccountId: a, destinationAccountId: b, amountCents: 1 }, null);
    expectContract(res, 'POST', '/v1/transfers');
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('[TRF-AC-04] replay: mesmo status e corpo, Idempotent-Replayed: true, uma transferência', async () => {
    const a = await account(100_000);
    const b = await account(0);
    const body = { sourceAccountId: a, destinationAccountId: b, amountCents: 15_000 };
    const first = await post(body, 'replay-key');
    // Mesmo payload com as chaves em outra ordem: o hash é do payload canônico.
    const second = await post(
      { amountCents: 15_000, destinationAccountId: b, sourceAccountId: a },
      'replay-key',
    );

    expectContract(second, 'POST', '/v1/transfers');
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await balance(a)).toBe(85_000);
  });

  it('[TRF-AC-05] mesma chave, payload diferente → 422 IDEMPOTENCY_KEY_REUSED e nada muda', async () => {
    const a = await account(100_000);
    const b = await account(0);
    await post(
      { sourceAccountId: a, destinationAccountId: b, amountCents: 15_000 },
      'reuse-key',
    ).expect(201);
    const res = await post(
      { sourceAccountId: a, destinationAccountId: b, amountCents: 20_000 },
      'reuse-key',
    );
    expectContract(res, 'POST', '/v1/transfers');
    expect(res.status).toBe(422);
    expect(bodyOf(res).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await balance(a)).toBe(85_000);
  });

  it('[TRF-AC-06] mesma chave em paralelo via HTTP: uma transferência; replays ou 409', async () => {
    const a = await account(100_000);
    const b = await account(0);
    const body = { sourceAccountId: a, destinationAccountId: b, amountCents: 1000 };
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => post(body, 'parallel-http')),
    );

    for (const res of responses) {
      expectContract(res, 'POST', '/v1/transfers');
      expect([201, 409]).toContain(res.status);
      if (res.status === 409) {
        expect(bodyOf(res).code).toBe('REQUEST_IN_PROGRESS');
        expect(res.headers['retry-after']).toBe('1');
      }
    }
    const ok = responses.filter((r) => r.status === 201);
    expect(ok.filter((r) => r.headers['idempotent-replayed'] !== 'true')).toHaveLength(1);
    expect(new Set(ok.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(await balance(a)).toBe(99_000);
  });

  it('[TRF-AC-08] origem = destino → 400 SAME_ACCOUNT', async () => {
    const a = await account(1000);
    const res = await post({ sourceAccountId: a, destinationAccountId: a, amountCents: 1 });
    expectContract(res, 'POST', '/v1/transfers');
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('SAME_ACCOUNT');
  });

  it('[TRF-AC-09] conta inexistente → 404 ACCOUNT_NOT_FOUND com o papel no detail', async () => {
    const a = await account(1000);
    const missing = '0193a1b2-7c4d-7e5f-8a6b-999999999999';

    const src = await post({ sourceAccountId: missing, destinationAccountId: a, amountCents: 1 });
    expectContract(src, 'POST', '/v1/transfers');
    expect(src.status).toBe(404);
    expect(bodyOf(src).code).toBe('ACCOUNT_NOT_FOUND');
    expect(bodyOf(src).detail).toContain('origem');

    const dst = await post({ sourceAccountId: a, destinationAccountId: missing, amountCents: 1 });
    expect(bodyOf(dst).code).toBe('ACCOUNT_NOT_FOUND');
    expect(bodyOf(dst).detail).toContain('destino');
  });

  it.each([
    ['zero', 0],
    ['negativo', -100],
    ['decimal', 150.5],
    ['string', '15000'],
    ['acima do teto', 100_000_001],
  ])(
    '[TRF-AC-10] amountCents %s → 400 VALIDATION_ERROR apontando amountCents',
    async (_c, amountCents) => {
      const a = await account(1000);
      const b = await account(0);
      const res = await post({ sourceAccountId: a, destinationAccountId: b, amountCents });
      expectContract(res, 'POST', '/v1/transfers');
      expect(res.status).toBe(400);
      expect(bodyOf(res).code).toBe('VALIDATION_ERROR');
      expect(bodyOf(res).errors.map((e) => e.path)).toContain('amountCents');
    },
  );

  it('[TRF-AC-12] x-correlation-id válido é devolvido e gravado em transfers e outbox; inválido gera UUID', async () => {
    const a = await account(10_000);
    const b = await account(0);
    const body = { sourceAccountId: a, destinationAccountId: b, amountCents: 1 };

    const valid = await post(body).set('x-correlation-id', 'c-123');
    expect(valid.headers['x-correlation-id']).toBe('c-123');

    const invalid = await post(body).set('x-correlation-id', 'a'.repeat(65));
    const generated = invalid.headers['x-correlation-id']!;
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);

    const { rows } = await t.owner.query<{ id: string; t: string; o: string }>(
      `SELECT tr.id, tr.correlation_id AS t, o.correlation_id AS o
         FROM transfers tr JOIN outbox o ON o.aggregate_id = tr.id
        WHERE tr.id = ANY($1::uuid[])`,
      [[bodyOf(valid).id, bodyOf(invalid).id]],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(bodyOf(valid).id)).toMatchObject({ t: 'c-123', o: 'c-123' });
    expect(byId.get(bodyOf(invalid).id)).toMatchObject({ t: generated, o: generated });
  });

  it.each([
    ['65 caracteres', 'k'.repeat(65)],
    ['caractere proibido', 'chave com espaço'],
    ['vazia', ''],
  ])('[TRF-AC-16] Idempotency-Key %s → 400 IDEMPOTENCY_KEY_INVALID', async (_c, key) => {
    const a = await account(1000);
    const b = await account(0);
    const res = await post({ sourceAccountId: a, destinationAccountId: b, amountCents: 1 }, key);
    expectContract(res, 'POST', '/v1/transfers');
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('[TRF-AC-18] falha não consome a chave: depois de receber saldo, a mesma chave executa', async () => {
    const a = await account(1000);
    const b = await account(0);
    const funder = await account(10_000);
    const body = { sourceAccountId: a, destinationAccountId: b, amountCents: 5000 };

    await post(body, 'retry-after-422').expect(422);
    await post({ sourceAccountId: funder, destinationAccountId: a, amountCents: 5000 }).expect(201);
    const retry = await post(body, 'retry-after-422');

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('ordem de validação TRF-BR-13: chave ausente vem antes do corpo inválido', async () => {
    const res = await post({ amountCents: 'x' }, null);
    expect(bodyOf(res).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('[TRF-BR-08] a mesma chave usada por outro cliente da API é independente', async () => {
    const a = await account(10_000);
    const b = await account(0);
    const body = { sourceAccountId: a, destinationAccountId: b, amountCents: 100 };
    await post(body, 'shared-key').expect(201);
    const other = await request(httpServer(app))
      .post('/v1/transfers')
      .set('x-api-key', OTHER_API_KEY)
      .set('idempotency-key', 'shared-key')
      .send(body);
    expect(other.status).toBe(201);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('GET /v1/transfers/{transferId}', () => {
  it('[TRF-AC-17] devolve o mesmo Transfer da criação; inexistente → 404 TRANSFER_NOT_FOUND', async () => {
    const a = await account(1000);
    const b = await account(0);
    const created = await post({ sourceAccountId: a, destinationAccountId: b, amountCents: 10 });

    const res = await http.get(`/v1/transfers/${bodyOf(created).id}`);
    expectContract(res, 'GET', '/v1/transfers/{transferId}');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(created.body);

    const missing = await http.get('/v1/transfers/0193a1b2-7c4d-7e5f-8a6b-999999999999');
    expectContract(missing, 'GET', '/v1/transfers/{transferId}');
    expect(missing.status).toBe(404);
    expect(bodyOf(missing).code).toBe('TRANSFER_NOT_FOUND');
  });
});
