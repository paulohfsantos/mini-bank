import type { Pool } from '@mini-banco/database';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { databaseResponds, HealthController } from './health.controller';

function fakeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
      return res;
    },
    status: (s: number) => {
      statusCode = s;
      return res;
    },
  };
  return { res: res as unknown as Response, headers, status: () => statusCode };
}

const pool = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;
const upPool = pool(() => Promise.resolve({ rows: [] }));
const downPool = pool(() => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:5432')));

describe('HealthController', () => {
  it('[OBS-AC-11] live: 200 só com status e no-store, sem tocar no banco', () => {
    let touched = false;
    const controller = new HealthController(
      pool(() => {
        touched = true;
        return Promise.resolve();
      }),
      { healthy: () => false },
    );
    const { res, headers } = fakeRes();
    expect(controller.live(res)).toEqual({ status: 'ok' });
    expect(headers['cache-control']).toBe('no-store');
    expect(touched).toBe(false);
  });

  it.each([
    ['banco e relay ok', upPool, true, 200, 'ok'],
    ['banco fora', downPool, true, 503, 'error'],
    ['relay sem ciclo recente', upPool, false, 503, 'error'],
  ] as const)('[OBS-AC-11] ready com %s → %i', async (_caso, db, relay, status, body) => {
    const controller = new HealthController(db, { healthy: () => relay });
    const { res, headers, status: got } = fakeRes();
    expect(await controller.ready(res)).toEqual({ status: body });
    expect(got()).toBe(status);
    expect(headers['cache-control']).toBe('no-store');
  });

  it('[OBS-AC-11] [SEC-17] banco que não responde em 1 s conta como fora, sem detalhes no corpo', async () => {
    const hanging = pool(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await databaseResponds(hanging, 50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
