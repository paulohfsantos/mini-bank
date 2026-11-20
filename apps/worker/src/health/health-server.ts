// OBS-BR-11: health HTTP mínimo do worker (o worker não tem servidor HTTP próprio).
// node:http puro em vez de @nestjs/terminus: o Terminus devolve nomes e detalhes de cada
// dependência, o que o SEC-17 proíbe, e exigiria transformar o worker num app HTTP do Nest.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from '@mini-banco/database';

const DB_CHECK_TIMEOUT_MS = 1_000;

export interface HealthChecks {
  pool: Pool;
  consumerHealthy: () => boolean;
}

async function databaseResponds(pool: Pool): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), DB_CHECK_TIMEOUT_MS);
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

export class HealthServer {
  private server: Server | undefined;

  constructor(private readonly checks: HealthChecks) {}

  /** Escuta em `port` (0 = porta livre, testes) e devolve a porta efetiva. */
  async listen(port: number, host?: string): Promise<number> {
    const server = createServer((req, res) => {
      void this.respond(req.method, req.url).then(({ status, body }) => {
        res.statusCode = status;
        // OBS-BR-12: só status, sem cache, sem detalhes de dependências.
        res.setHeader('cache-control', 'no-store');
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(body));
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
    return (server.address() as AddressInfo).port;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async respond(method: string | undefined, url: string | undefined) {
    const path = (url ?? '/').split('?')[0];
    if (method === 'GET' && path === '/health/live') {
      return { status: 200, body: { status: 'ok' } };
    }
    if (method === 'GET' && path === '/health/ready') {
      const ok = this.checks.consumerHealthy() && (await databaseResponds(this.checks.pool));
      return { status: ok ? 200 : 503, body: { status: ok ? 'ok' : 'error' } };
    }
    return { status: 404, body: { status: 'error' } };
  }
}
