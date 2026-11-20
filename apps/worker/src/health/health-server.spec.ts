import type { Pool } from '@mini-banco/database';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthServer } from './health-server';

const pool = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;
const up = pool(() => Promise.resolve({ rows: [] }));
const down = pool(() => Promise.reject(new Error('ECONNREFUSED db.internal:5432')));

let server: HealthServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start(db: Pool, consumerHealthy: boolean) {
  server = new HealthServer({ pool: db, consumerHealthy: () => consumerHealthy });
  const port = await server.listen(0, '127.0.0.1');
  return (path: string) => fetch(`http://127.0.0.1:${port}${path}`);
}

describe('HealthServer do worker', () => {
  it('[OBS-AC-12] live e ready 200 {status: ok} com no-store', async () => {
    const get = await start(up, true);
    for (const path of ['/health/live', '/health/ready']) {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ status: 'ok' });
    }
  });

  it.each([
    ['banco fora', down, true],
    ['consumidor com falha no ReceiveMessage', up, false],
  ])('[OBS-AC-12] %s → ready 503 e live continua 200', async (_caso, db, consumer) => {
    const get = await start(db, consumer);
    const ready = await get('/health/ready');
    expect(ready.status).toBe(503);
    // SEC-17: nada de host, porta ou mensagem do erro.
    expect(await ready.text()).toBe('{"status":"error"}');
    expect((await get('/health/live')).status).toBe(200);
  });

  it('[OBS-AC-12] outras rotas → 404', async () => {
    const get = await start(up, true);
    expect((await get('/metrics')).status).toBe(404);
    expect((await get('/')).status).toBe(404);
  });
});
