import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { getCorrelationId } from './correlation';
import { createHttpLogger } from './http-logger';
import { createLogger } from './logger';
import { MemoryStream } from './test-support/memory-stream';

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

/** Sobe um servidor http com o middleware e um handler que ecoa o correlationId do contexto. */
async function start(status = 200) {
  const stream = new MemoryStream();
  const middleware = createHttpLogger(createLogger({ service: 'api', destination: stream }));
  server = createServer((req, res) => {
    middleware(req, res, () => {
      // Simula trabalho assíncrono do handler: o contexto precisa sobreviver ao await.
      void Promise.resolve().then(() => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ seen: getCorrelationId() }));
      });
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { stream, url: `http://127.0.0.1:${port}` };
}

describe('createHttpLogger', () => {
  it('[SEC-12] devolve o x-correlation-id válido e o expõe no contexto do handler', async () => {
    const { url } = await start();
    const res = await fetch(`${url}/v1/accounts`, { headers: { 'x-correlation-id': 'c-123' } });
    expect(res.headers.get('x-correlation-id')).toBe('c-123');
    expect(await res.json()).toEqual({ seen: 'c-123' });
  });

  it('[SEC-12] gera um id novo quando o header é inválido', async () => {
    const { url } = await start();
    const res = await fetch(url, { headers: { 'x-correlation-id': 'a'.repeat(65) } });
    const id = res.headers.get('x-correlation-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toEqual({ seen: id });
  });

  it('[PERF-24] escreve uma única linha por requisição, sem body nem query string', async () => {
    const { url, stream } = await start(201);
    await fetch(`${url}/v1/accounts?cursor=abc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'c-9' },
      body: JSON.stringify({ document: '52998224725', holderName: 'Maria' }),
    });
    await new Promise((r) => setImmediate(r));

    expect(stream.lines).toHaveLength(1);
    expect(stream.lines[0]).toMatchObject({
      msg: 'request completed',
      level: 'info',
      correlationId: 'c-9',
      method: 'POST',
      path: '/v1/accounts',
      status: 201,
    });
    expect(typeof stream.lines[0]?.durationMs).toBe('number');
    expect(stream.raw).not.toContain('52998224725');
    expect(stream.raw).not.toContain('Maria');
    expect(stream.raw).not.toContain('cursor');
  });

  it.each([
    [404, 'warn'],
    [500, 'error'],
  ])('status %i é logado como %s', async (status, level) => {
    const { url, stream } = await start(status);
    await fetch(url);
    await new Promise((r) => setImmediate(r));
    expect(stream.lines[0]).toMatchObject({ level, status });
  });

  it('[SEC-21] não loga x-api-key nem authorization', async () => {
    const { url, stream } = await start();
    await fetch(url, { headers: { 'x-api-key': 'segredo', authorization: 'Bearer abc' } });
    await new Promise((r) => setImmediate(r));
    expect(stream.raw).not.toContain('segredo');
    expect(stream.raw).not.toContain('Bearer abc');
  });
});
