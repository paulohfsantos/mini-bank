import type * as Crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { ArgumentsHost } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { ERROR_CODES } from '@mini-banco/contracts';
import type { Logger } from '@mini-banco/observability';
import { describe, expect, it, vi } from 'vitest';

const timingSafeEqualSpy = vi.hoisted(() => vi.fn());
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof Crypto>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});
import { AccountBusyError, InsufficientFundsError } from '../../domain/errors';
import { type AuthenticatedRequest, createApiKeyAuth } from './middlewares';
import { buildProblem, STATUS_BY_CODE } from './problem';
import { ProblemExceptionFilter } from './problem.filter';

class FakeResponse {
  statusCode = 200;
  headersSent = false;
  headers = new Map<string, string>();
  body = '';
  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
  }
  end(chunk: string) {
    this.body = chunk;
    this.headersSent = true;
  }
  json(): Record<string, unknown> {
    return JSON.parse(this.body) as Record<string, unknown>;
  }
}

const asRes = (r: FakeResponse) => r as unknown as ServerResponse;

describe('createApiKeyAuth', () => {
  const auth = createApiKeyAuth([
    { clientId: 'web', key: 'web-key-0123456789' },
    { clientId: 'cli', key: 'cli-key-0123456789' },
  ]);

  function call(url: string, apiKey?: string) {
    const req = { url, headers: apiKey === undefined ? {} : { 'x-api-key': apiKey } };
    const res = new FakeResponse();
    const next = vi.fn();
    auth(req as unknown as AuthenticatedRequest, asRes(res), next);
    return { req: req as unknown as AuthenticatedRequest, res, next };
  }

  it('[SEC-08] identifica o cliente pela chave e o anexa à requisição', () => {
    const { req, next } = call('/v1/accounts', 'cli-key-0123456789');
    expect(next).toHaveBeenCalledOnce();
    expect(req.clientId).toBe('cli');
  });

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['prefixo de uma válida', 'web-key-012345678'],
    ['muito longa', 'x'.repeat(257)],
  ])('[SEC-08] chave %s → 401 problem+json, sem chamar a rota', (_c, key) => {
    const { res, next } = call('/v1/accounts', key);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('[SEC-08] compara com timingSafeEqual contra todas as chaves, sem sair na primeira', () => {
    timingSafeEqualSpy.mockClear();
    call('/v1/accounts', 'web-key-0123456789'); // casa com a primeira chave
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(2);
  });

  it.each(['/health/live', '/health/ready', '/docs', '/docs/swagger-ui.css', '/health/live?x=1'])(
    'rota pública %s passa sem chave',
    (url) => {
      expect(call(url).next).toHaveBeenCalledOnce();
    },
  );

  it.each(['/healthz', '/health/live/x', '/docsx', '/v1/accounts?path=/docs'])(
    '%s não é rota pública',
    (url) => {
      expect(call(url).res.statusCode).toBe(401);
    },
  );
});

describe('problem+json', () => {
  it('todo code do contrato tem status e title', () => {
    for (const code of ERROR_CODES) {
      const problem = buildProblem(code);
      expect(problem.status, code).toBe(STATUS_BY_CODE[code]);
      expect(problem.title.length, code).toBeGreaterThan(0);
      expect(problem.type).toMatch(/^https:\/\/mini-banco\.dev\/problems\/[a-z-]+$/);
    }
  });
});

describe('ProblemExceptionFilter', () => {
  const logger = { error: vi.fn() };
  const filter = new ProblemExceptionFilter(logger as unknown as Logger);

  function handle(exception: unknown) {
    const res = new FakeResponse();
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    filter.catch(exception, host as unknown as ArgumentsHost);
    return res;
  }

  it('erro de domínio vira o code correspondente', () => {
    const res = handle(new InsufficientFundsError());
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
  });

  it('[PERF-06] ACCOUNT_BUSY responde 503 com Retry-After', () => {
    const res = handle(new AccountBusyError());
    expect(res.statusCode).toBe(503);
    expect(res.headers.get('retry-after')).toBe('1');
  });

  it('404 do roteador do Nest vira ROUTE_NOT_FOUND', () => {
    expect(handle(new NotFoundException()).json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  it('[SEC-13] erro desconhecido: 500 genérico; log sem o detail do Postgres (SEC-21)', () => {
    const pgError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (document)=(52998224725) already exists.',
    });
    const res = handle(pgError);
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('duplicate');
    expect(res.body).not.toContain('52998224725');

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain('23505');
    expect(logged).not.toContain('52998224725');
  });

  it('não escreve de novo se a resposta já foi enviada', () => {
    const res = new FakeResponse();
    res.headersSent = true;
    const host = { switchToHttp: () => ({ getResponse: () => res }) };
    filter.catch(new Error('x'), host as unknown as ArgumentsHost);
    expect(res.body).toBe('');
  });
});
