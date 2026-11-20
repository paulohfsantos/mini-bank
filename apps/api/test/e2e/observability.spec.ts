// E2E (Supertest, app completa no processo): saúde, Swagger em produção e métricas de
// transferência (OBS). Traces com instrumentação real ficam em telemetry-system.spec.ts.
import type { INestApplication } from '@nestjs/common';
import { createPool } from '@mini-banco/database';
import { startTestTelemetry, type TestTelemetry } from '@mini-banco/observability/testing';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import {
  API_KEY,
  httpServer,
  openTestDb,
  silentLogger,
  startApp,
  testConfig,
  type TestDb,
} from '../support/app';
import { expectContract } from '../support/contract';
import { nextCpf } from '../support/cpf';

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t.close();
});

describe('health checks', () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await startApp(t);
  });
  afterEach(async () => {
    await app.close();
  });

  it('[OBS-AC-11] live e ready 200 {status: ok}, no-store, conforme o contrato', async () => {
    for (const path of ['/health/live', '/health/ready'] as const) {
      const res = await request(httpServer(app)).get(path);
      expectContract(res, 'GET', path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('[OBS-AC-11] Postgres indisponível → ready 503 {status: error} e live continua 200', async () => {
    const deadPool = createPool({
      connectionString: 'postgres://x:y@127.0.0.1:1/none',
      applicationName: 'test',
      max: 1,
      connectionTimeoutMillis: 500,
    });
    const down = await createApp({ config: testConfig, logger: silentLogger, pool: deadPool });
    try {
      const ready = await request(httpServer(down)).get('/health/ready');
      expectContract(ready, 'GET', '/health/ready');
      expect(ready.status).toBe(503);
      // SEC-17: só o status; nada de host, porta ou mensagem do driver.
      expect(ready.text).toBe('{"status":"error"}');
      expect((await request(httpServer(down)).get('/health/live')).status).toBe(200);
    } finally {
      await down.close();
      await deadPool.end();
    }
  });
});

describe('Swagger', () => {
  it('[OBS-AC-13] com NODE_ENV=production /docs não existe: 401 sem key, 404 ROUTE_NOT_FOUND com key', async () => {
    const prod = await createApp({
      config: { ...testConfig, production: true },
      logger: silentLogger,
      pool: t.db.pool,
    });
    try {
      expect((await request(httpServer(prod)).get('/docs/')).status).toBe(401);
      const withKey = await request(httpServer(prod)).get('/docs/').set('x-api-key', API_KEY);
      expect(withKey.status).toBe(404);
      expect(withKey.body).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
    } finally {
      await prod.close();
    }
  });

  it('[OBS-AC-13] fora de produção /docs continua 200', async () => {
    const dev = await startApp(t);
    try {
      expect((await request(httpServer(dev)).get('/docs/')).status).toBe(200);
    } finally {
      await dev.close();
    }
  });
});

describe('métricas de transferência', () => {
  let app: INestApplication;
  let telemetry: TestTelemetry;
  let seq = 0;

  beforeEach(async () => {
    telemetry = startTestTelemetry('api');
    app = await startApp(t);
  });
  afterEach(async () => {
    await app.close();
    await telemetry.shutdown();
  });

  async function account(balance: number): Promise<string> {
    const res = await request(httpServer(app))
      .post('/v1/accounts')
      .set('x-api-key', API_KEY)
      .send({ holderName: 'Métrica', document: nextCpf(), initialBalanceCents: balance });
    return (res.body as { id: string }).id;
  }

  function transfer(source: string, destination: string, amountCents: number, key: string) {
    return request(httpServer(app))
      .post('/v1/transfers')
      .set('x-api-key', API_KEY)
      .set('idempotency-key', key)
      .send({ sourceAccountId: source, destinationAccountId: destination, amountCents });
  }

  it('[OBS-AC-07] sucesso conta 1, replay não conta, saldo insuficiente conta como rejeição', async () => {
    const [a, b] = [await account(10_000), await account(0)];
    const key = `m-${++seq}`;
    expect((await transfer(a, b, 5_000, key)).status).toBe(201);
    const replay = await transfer(a, b, 5_000, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((await transfer(a, b, 999_999, `m-${++seq}`)).status).toBe(422);

    expect(await telemetry.value('transfers_completed')).toBe(1);
    expect(await telemetry.value('transfers_rejected', { reason: 'INSUFFICIENT_FUNDS' })).toBe(1);
  });

  it('[OBS-AC-07] rejeições antes do controller (401) também contam, pelo code', async () => {
    await request(httpServer(app)).post('/v1/transfers').send({});
    expect(await telemetry.value('transfers_rejected', { reason: 'UNAUTHORIZED' })).toBe(1);
    expect(await telemetry.value('transfers_completed')).toBe(0);
  });
});
