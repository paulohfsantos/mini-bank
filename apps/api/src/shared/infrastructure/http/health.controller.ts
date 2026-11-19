import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Health } from '@mini-banco/contracts';
import type { Pool } from '@mini-banco/database';
import type { Response } from 'express';
import { POOL } from '../database.module';

/** Sem autenticação (consumidos pelo ALB). Liveness não toca no banco. */
@Controller('health')
export class HealthController {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  @Get('live')
  live(): Health {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<Health> {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      res.status(503);
      return { status: 'error' };
    }
  }
}
