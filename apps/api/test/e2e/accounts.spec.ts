import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY, httpServer, openTestDb, startApp, type TestDb } from '../support/app';
import { bodyOf, expectContract } from '../support/contract';
import { nextCpf } from '../support/cpf';

let t: TestDb;
let app: INestApplication;
let http: ReturnType<typeof request.agent>;

beforeAll(async () => {
  t = await openTestDb();
  app = await startApp(t);
  http = request.agent(httpServer(app)).set('x-api-key', API_KEY);
});

afterAll(async () => {
  await app.close();
  await t.close();
});

const valid = () => ({
  holderName: 'Maria da Silva',
  document: nextCpf(),
  initialBalanceCents: 150_000,
});

describe('POST /v1/accounts', () => {
  it('[ACC-AC-01] cria a conta: 201, Location e lançamento OPENING', async () => {
    const res = await http.post('/v1/accounts').send(valid());
    expectContract(res, 'POST', '/v1/accounts');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ holderName: 'Maria da Silva', balanceCents: 150_000 });
    expect(res.headers.location).toBe(`/v1/accounts/${bodyOf(res).id}`);

    const { rows } = await t.owner.query(
      'SELECT type, amount_cents::int, balance_after_cents::int FROM ledger_entries WHERE account_id = $1',
      [bodyOf(res).id],
    );
    expect(rows).toEqual([
      { type: 'OPENING', amount_cents: 150_000, balance_after_cents: 150_000 },
    ]);
  });

  it('[ACC-AC-02] CPF já cadastrado → 409 DOCUMENT_ALREADY_REGISTERED, sem conta nova', async () => {
    const body = valid();
    await http.post('/v1/accounts').send(body).expect(201);
    const res = await http.post('/v1/accounts').send({ ...body, holderName: 'Outro' });
    expectContract(res, 'POST', '/v1/accounts');
    expect(res.status).toBe(409);
    expect(bodyOf(res).code).toBe('DOCUMENT_ALREADY_REGISTERED');
    const { rows } = await t.owner.query(
      'SELECT count(*)::int AS n FROM accounts WHERE document = $1',
      [body.document],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it.each([
    ['negativo', -1],
    ['decimal', 10.5],
    ['string', '100'],
    ['acima do teto', 10_000_001],
  ])(
    '[ACC-AC-03] saldo inicial %s → 400 VALIDATION_ERROR apontando initialBalanceCents',
    async (_c, value) => {
      const res = await http.post('/v1/accounts').send({ ...valid(), initialBalanceCents: value });
      expectContract(res, 'POST', '/v1/accounts');
      expect(res.status).toBe(400);
      expect(bodyOf(res).code).toBe('VALIDATION_ERROR');
      expect(bodyOf(res).errors.map((e) => e.path)).toContain('initialBalanceCents');
    },
  );

  it.each([
    ['dígito verificador errado', '52998224724'],
    ['sequência repetida', '11111111111'],
    ['curto', '5299822472'],
    ['longo', '529982247250'],
    ['com pontuação', '529.982.247-25'],
  ])('[ACC-AC-04] CPF %s → 400 INVALID_DOCUMENT', async (_c, document) => {
    const res = await http.post('/v1/accounts').send({ ...valid(), document });
    expectContract(res, 'POST', '/v1/accounts');
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('INVALID_DOCUMENT');
  });

  it('[ACC-AC-08] campo desconhecido → 400 VALIDATION_ERROR; corpo > 16 KB → 413 PAYLOAD_TOO_LARGE', async () => {
    const extra = await http.post('/v1/accounts').send({ ...valid(), balanceCents: 1 });
    expectContract(extra, 'POST', '/v1/accounts');
    expect(extra.status).toBe(400);
    expect(bodyOf(extra).code).toBe('VALIDATION_ERROR');

    const big = await http
      .post('/v1/accounts')
      .send({ ...valid(), holderName: 'x'.repeat(17 * 1024) });
    expectContract(big, 'POST', '/v1/accounts');
    expect(big.status).toBe(413);
    expect(bodyOf(big).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('[ACC-AC-09] nome é aparado e normalizado em NFC; vazio, longo ou com controle → 400', async () => {
    const res = await http
      .post('/v1/accounts')
      .send({ ...valid(), holderName: '  José Conceição  ' });
    expect(res.status).toBe(201);
    expect(bodyOf(res).holderName).toBe('José Conceição');
    const { rows } = await t.owner.query('SELECT holder_name FROM accounts WHERE id = $1', [
      bodyOf(res).id,
    ]);
    expect(rows[0]).toEqual({ holder_name: 'José Conceição' });

    for (const holderName of ['   ', 'a'.repeat(121), 'Maria\nSilva']) {
      const bad = await http.post('/v1/accounts').send({ ...valid(), holderName });
      expectContract(bad, 'POST', '/v1/accounts');
      expect(bad.status, JSON.stringify(holderName)).toBe(400);
      expect(bodyOf(bad).code).toBe('VALIDATION_ERROR');
    }
  });

  it('[ACC-AC-10] resposta só traz o CPF mascarado, na criação e na consulta', async () => {
    const created = await http.post('/v1/accounts').send({ ...valid(), document: '52998224725' });
    expect(created.status).toBe(201);
    expect(bodyOf(created).documentMasked).toBe('***.982.247-**');
    expect(created.text).not.toContain('52998224725');

    const fetched = await http.get(`/v1/accounts/${bodyOf(created).id}`);
    expect(bodyOf(fetched).documentMasked).toBe('***.982.247-**');
    expect(fetched.text).not.toContain('52998224725');
  });
});

describe('GET /v1/accounts/{accountId}', () => {
  it('[ACC-AC-05] devolve a conta com o saldo atual (depois de transferências)', async () => {
    const a = bodyOf(await http.post('/v1/accounts').send(valid())).id;
    const b = bodyOf(
      await http.post('/v1/accounts').send({ ...valid(), initialBalanceCents: 0 }),
    ).id;
    await http
      .post('/v1/transfers')
      .set('idempotency-key', `acc5-${a}`)
      .send({ sourceAccountId: a, destinationAccountId: b, amountCents: 50_000 })
      .expect(201);

    const res = await http.get(`/v1/accounts/${a}`);
    expectContract(res, 'GET', '/v1/accounts/{accountId}');
    expect(res.status).toBe(200);
    expect(bodyOf(res).balanceCents).toBe(100_000);
  });

  it('[ACC-AC-06] inexistente → 404 ACCOUNT_NOT_FOUND; id que não é UUID → 400 VALIDATION_ERROR', async () => {
    const missing = await http.get('/v1/accounts/0193a1b2-7c4d-7e5f-8a6b-999999999999');
    expectContract(missing, 'GET', '/v1/accounts/{accountId}');
    expect(missing.status).toBe(404);
    expect(bodyOf(missing).code).toBe('ACCOUNT_NOT_FOUND');

    const bad = await http.get("/v1/accounts/' OR 1=1 --");
    expectContract(bad, 'GET', '/v1/accounts/{accountId}');
    expect(bad.status).toBe(400);
    expect(bodyOf(bad).code).toBe('VALIDATION_ERROR');
  });
});

describe('autenticação', () => {
  it('[ACC-AC-07] sem x-api-key ou com chave inválida → 401, sem revelar se o recurso existe', async () => {
    const server = httpServer(app);
    const created = await http.post('/v1/accounts').send(valid());

    for (const req of [
      request(server).get(`/v1/accounts/${bodyOf(created).id}`),
      request(server)
        .get('/v1/accounts/0193a1b2-7c4d-7e5f-8a6b-999999999999')
        .set('x-api-key', 'errada'),
      request(server).post('/v1/accounts').send(valid()),
    ]) {
      const res = await req;
      expect(res.status).toBe(401);
      expect(bodyOf(res).code).toBe('UNAUTHORIZED');
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    }
  });
});
