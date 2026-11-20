import { CORRELATION_ID_PATTERN } from '@mini-banco/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, createApiClient } from './api-client';

const ACCOUNT = {
  id: '0193a1b2-7c4d-7e5f-8a6b-0000000000aa',
  holderName: 'Maria',
  documentMasked: '***.982.247-**',
  balanceCents: 1000,
  createdAt: '2026-11-18T14:00:00.000Z',
  updatedAt: '2026-11-18T14:00:00.000Z',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });

const client = () =>
  createApiClient({
    baseUrl: 'http://api.test',
    apiKey: 'secret-key-0123456789',
    correlationId: 'c-abc',
  });

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

describe('createApiClient', () => {
  it('[WEB-AC-10] envia x-api-key e x-correlation-id; saldo com cache no-store', async () => {
    fetchMock.mockResolvedValue(json(200, ACCOUNT));
    await client().getAccount(ACCOUNT.id);

    const { url, init, headers } = lastCall();
    expect(url).toBe(`http://api.test/v1/accounts/${ACCOUNT.id}`);
    expect(headers.get('x-api-key')).toBe('secret-key-0123456789');
    expect(headers.get('x-correlation-id')).toMatch(CORRELATION_ID_PATTERN);
    expect(init.cache).toBe('no-store');
  });

  it('[WEB-AC-10] extrato também é no-store e leva o cursor', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [], nextCursor: null }));
    await client().getStatement(ACCOUNT.id, { cursor: 'abc_-', limit: 20 });
    const { url, init } = lastCall();
    expect(url).toBe(`http://api.test/v1/accounts/${ACCOUNT.id}/statement?limit=20&cursor=abc_-`);
    expect(init.cache).toBe('no-store');
  });

  it('[WEB-AC-10] transferência envia a Idempotency-Key recebida', async () => {
    fetchMock.mockResolvedValue(
      json(201, {
        id: '0193a1b2-7c4d-7e5f-8a6b-000000000001',
        sourceAccountId: ACCOUNT.id,
        destinationAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000bb',
        amountCents: 100,
        status: 'COMPLETED',
        createdAt: '2026-11-18T14:00:00.000Z',
      }),
    );
    await client().createTransfer(
      {
        sourceAccountId: ACCOUNT.id,
        destinationAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000bb',
        amountCents: 100,
      },
      'key-123',
    );
    const { init, headers } = lastCall();
    expect(init.method).toBe('POST');
    expect(headers.get('idempotency-key')).toBe('key-123');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('[WEB-AC-09] problem+json vira ApiFailure tipada; corpo não validado não passa como sucesso', async () => {
    fetchMock.mockResolvedValue(
      json(
        404,
        {
          type: 'https://mini-banco.dev/problems/account-not-found',
          title: 't',
          status: 404,
          code: 'ACCOUNT_NOT_FOUND',
          correlationId: 'c-abc',
        },
        'application/problem+json',
      ),
    );
    const error = await client()
      .getAccount(ACCOUNT.id)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiFailure);
    expect((error as ApiFailure).failure).toMatchObject({
      kind: 'problem',
      problem: { code: 'ACCOUNT_NOT_FOUND' },
    });

    fetchMock.mockResolvedValue(json(200, { unexpected: true }));
    const bad = await client()
      .getAccount(ACCOUNT.id)
      .catch((e: unknown) => e);
    expect((bad as ApiFailure).failure.kind).toBe('unexpected');
  });

  it('[WEB-AC-09] falha de rede vira ApiFailure network com o correlationId', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const error = await client()
      .getAccount(ACCOUNT.id)
      .catch((e: unknown) => e);
    expect((error as ApiFailure).failure).toEqual({ kind: 'network', correlationId: 'c-abc' });
  });
});
