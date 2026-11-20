import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Health } from '@mini-banco/contracts';
import type { Pool } from '@mini-banco/database';
import type { Response } from 'express';
import { POOL } from '../database.module';

/** Sinal de vida do relay do outbox (OBS-BR-10). Com o relay desligado, sempre saudável. */
export interface RelayHeartbeat {
  healthy(now?: number): boolean;
}
export const RELAY_HEARTBEAT = Symbol('RelayHeartbeat');

const DB_CHECK_TIMEOUT_MS = 1_000;

/** Postgres responde `SELECT 1` dentro do prazo. Nunca lança. */
export async function databaseResponds(pool: Pool, timeoutMs = DB_CHECK_TIMEOUT_MS) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const check = pool.query('SELECT 1').then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sem autenticação (consumidos pelo ALB). Liveness não toca em dependências. Corpo só com
 * `status` e sem cache (OBS-BR-12, SEC-17). SQS fora do ar não afeta a readiness: o outbox
 * guarda os eventos até ele voltar.
 */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(RELAY_HEARTBEAT) private readonly relay: RelayHeartbeat,
  ) {}

  @Get('live')
  live(@Res({ passthrough: true }) res: Response): Health {
    res.setHeader('cache-control', 'no-store');
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<Health> {
    res.setHeader('cache-control', 'no-store');
    const ok = this.relay.healthy() && (await databaseResponds(this.pool));
    if (!ok) res.status(503);
    return { status: ok ? 'ok' : 'error' };
  }
}
