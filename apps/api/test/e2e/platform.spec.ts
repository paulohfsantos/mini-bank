// Comportamentos transversais (specs/README.md, erros transversais) e infraestrutura HTTP.
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY, httpServer, openTestDb, startApp, type TestDb } from '../support/app';
import { bodyOf, expectContract } from '../support/contract';

let t: TestDb;
let app: INestApplication;

beforeAll(async () => {
  t = await openTestDb();
  app = await startApp(t);
});

afterAll(async () => {
  await app.close();
  await t.close();
});

describe('plataforma HTTP', () => {
  it('health checks são públicos e seguem o contrato', async () => {
    const live = await request(httpServer(app)).get('/health/live');
    expectContract(live, 'GET', '/health/live');
    expect(live.body).toEqual({ status: 'ok' });

    const ready = await request(httpServer(app)).get('/health/ready');
    expectContract(ready, 'GET', '/health/ready');
    expect(ready.body).toEqual({ status: 'ok' });
  });

  it('rota inexistente: 401 sem chave (não revela rotas) e 404 ROUTE_NOT_FOUND com chave', async () => {
    const anon = await request(httpServer(app)).get('/v1/nao-existe');
    expect(anon.status).toBe(401);

    const res = await request(httpServer(app)).get('/v1/nao-existe').set('x-api-key', API_KEY);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'ROUTE_NOT_FOUND', status: 404 });
  });

  it('JSON malformado → 400 VALIDATION_ERROR em problem+json', async () => {
    const res = await request(httpServer(app))
      .post('/v1/accounts')
      .set('x-api-key', API_KEY)
      .set('content-type', 'application/json')
      .send('{"holderName": ');
    expectContract(res, 'POST', '/v1/accounts');
    expect(res.status).toBe(400);
    expect(bodyOf(res).code).toBe('VALIDATION_ERROR');
  });

  it('[SEC-13] erro desconhecido → 500 genérico com correlationId, sem detalhes internos', async () => {
    // Derruba a tabela de contas por baixo da aplicação para provocar um erro do Postgres.
    await t.owner.query('ALTER TABLE accounts RENAME TO accounts_tmp');
    try {
      const res = await request(httpServer(app))
        .get('/v1/accounts/0193a1b2-7c4d-7e5f-8a6b-999999999999')
        .set('x-api-key', API_KEY)
        .set('x-correlation-id', 'c-500');
      expectContract(res, 'GET', '/v1/accounts/{accountId}');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        type: 'https://mini-banco.dev/problems/internal-error',
        title: 'Erro interno',
        status: 500,
        code: 'INTERNAL_ERROR',
        correlationId: 'c-500',
      });
      expect(res.text).not.toMatch(/relation "|does not exist|postgres|accounts_tmp|\.ts:\d+/i);
    } finally {
      await t.owner.query('ALTER TABLE accounts_tmp RENAME TO accounts');
    }
  });

  it('headers de segurança (helmet) e nenhum CORS', async () => {
    const res = await request(httpServer(app))
      .get('/health/live')
      .set('origin', 'https://evil.example');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('Swagger UI em /docs serve o openapi.yaml sem exigir chave', async () => {
    const res = await request(httpServer(app)).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
