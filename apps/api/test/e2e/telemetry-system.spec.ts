// E2E de sistema (OBS-AC-01, 06, 09, 10, 14): API e worker rodando a partir do build
// (`dist/`), como em produção, com o SDK carregado por `--import`, instrumentação real de
// http/pg/aws-sdk e export OTLP/HTTP (JSON) para um coletor de teste neste processo.
// Postgres e ElasticMQ dos containers de teste. Os processos conectam como o usuário admin
// do container (os GRANTs dos papéis já são exercitados nos outros testes).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createTestDatabase, type TestDatabase } from '@mini-banco/database/testing';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { nextCpf } from '../support/cpf';

const ROOT = resolve(import.meta.dirname, '../../../..');
const KEY = 'system-test-key-0123456789';
const HOLDER = 'Fulana Observada da Silva';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------- coletor OTLP/HTTP JSON ----------

interface OtlpAttribute {
  key: string;
  value: Record<string, unknown>;
}
interface CollectedSpan {
  service: string;
  scope: string;
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  attributes: Record<string, unknown>;
  raw: unknown;
}

function attrs(list: OtlpAttribute[] | undefined): Record<string, unknown> {
  return Object.fromEntries((list ?? []).map((a) => [a.key, Object.values(a.value)[0]]));
}

/** O exporter JSON manda ids em hex (OTLP/JSON); normaliza para minúsculas. */
const hex = (id: unknown) => (typeof id === 'string' ? id.toLowerCase() : '');

function startCollector(): Promise<{ server: Server; port: number; spans: CollectedSpan[] }> {
  const spans: CollectedSpan[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/v1/traces') {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          resourceSpans?: {
            resource?: { attributes?: OtlpAttribute[] };
            scopeSpans?: { scope?: { name?: string }; spans?: Record<string, unknown>[] }[];
          }[];
        };
        for (const rs of body.resourceSpans ?? []) {
          const service = String(attrs(rs.resource?.attributes)['service.name']);
          for (const ss of rs.scopeSpans ?? []) {
            for (const s of ss.spans ?? []) {
              spans.push({
                service,
                scope: ss.scope?.name ?? '',
                name: String(s.name),
                traceId: hex(s.traceId),
                spanId: hex(s.spanId),
                parentSpanId: hex(s.parentSpanId),
                attributes: attrs(s.attributes as OtlpAttribute[]),
                raw: s,
              });
            }
          }
        }
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({ server, port: (server.address() as AddressInfo).port, spans }),
    ),
  );
}

// ---------- processos ----------

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', () => ok()));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

interface Proc {
  child: ChildProcess;
  logs: Record<string, unknown>[];
  bootMs: Promise<number>;
}

function startProcess(app: 'api' | 'worker', env: Record<string, string>, ready: string): Proc {
  const startedAt = performance.now();
  const child = spawn(
    process.execPath,
    ['--enable-source-maps', '--import', '@mini-banco/observability/register', 'dist/main.js'],
    { cwd: resolve(ROOT, 'apps', app), env: { PATH: process.env.PATH ?? '', ...env } },
  );
  const logs: Record<string, unknown>[] = [];
  let resolveBoot: (ms: number) => void = () => undefined;
  const bootMs = new Promise<number>((ok, fail) => {
    resolveBoot = ok;
    child.once('exit', (code) => fail(new Error(`${app} saiu com código ${code}`)));
  });
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        logs.push(parsed);
        if (parsed.msg === ready) resolveBoot(performance.now() - startedAt);
      } catch {
        // linha não-JSON (não deveria acontecer): ignorada
      }
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${app}] ${chunk.toString()}`));
  return { child, logs, bootMs };
}

async function stop(proc: Proc | undefined): Promise<void> {
  if (proc?.child.exitCode !== null) return;
  const exited = new Promise((ok) => proc.child.once('exit', ok));
  proc.child.kill('SIGTERM');
  await exited;
}

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, ms = 20_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timeout esperando condição');
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------- cenário ----------

let db: TestDatabase;
let collector: Awaited<ReturnType<typeof startCollector>>;
let api: Proc;
let worker: Proc;
let apiPort: number;
let apiMetricsPort: number;
let workerMetricsPort: number;
const documents: string[] = [];
let transferId = '';
let baseEnv: Record<string, string>;

function apiFetch(path: string, init: RequestInit = {}, port = apiPort) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-api-key': KEY, ...init.headers },
  });
}

beforeAll(async () => {
  // O teste exercita o build: compila api, worker e os pacotes de que dependem (SWC, ~2 s).
  execFileSync(
    'pnpm',
    ['--filter', '@mini-banco/api...', '--filter', '@mini-banco/worker...', 'run', 'build'],
    { cwd: ROOT, stdio: 'ignore' },
  );

  db = await createTestDatabase(inject('pgAdminUrl'));
  const sqs = createTestSqsClient(inject('sqsEndpoint'));
  const { queueUrl } = await createTestQueues(sqs);
  sqs.destroy();
  collector = await startCollector();

  const pgUrl = new URL(db.url);
  [apiPort, apiMetricsPort, workerMetricsPort] = [
    await freePort(),
    await freePort(),
    await freePort(),
  ];
  baseEnv = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
    DB_HOST: pgUrl.hostname,
    DB_PORT: pgUrl.port,
    DB_NAME: pgUrl.pathname.slice(1),
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_ENDPOINT_URL: inject('sqsEndpoint'),
    SQS_QUEUE_URL: queueUrl,
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}`,
  };
  const user = decodeURIComponent(pgUrl.username);
  const password = decodeURIComponent(pgUrl.password);

  api = startProcess(
    'api',
    {
      ...baseEnv,
      PORT: String(apiPort),
      API_KEYS: `web:${KEY}`,
      API_DB_USER: user,
      API_DB_PASSWORD: password,
      OUTBOX_RELAY_ENABLED: 'true',
      OTEL_SERVICE_NAME: 'api',
      METRICS_PORT: String(apiMetricsPort),
    },
    'api listening',
  );
  worker = startProcess(
    'worker',
    {
      ...baseEnv,
      WORKER_DB_USER: user,
      WORKER_DB_PASSWORD: password,
      WORKER_HEALTH_PORT: String(await freePort()),
      OTEL_SERVICE_NAME: 'worker',
      METRICS_PORT: String(workerMetricsPort),
    },
    'worker running',
  );
  const bootMs = await api.bootMs;
  await worker.bootMs;
  process.stdout.write(`\nOBS-NFR-01 boot da API com SDK: ${Math.round(bootMs)} ms\n`);

  // Fluxo: duas contas (CPF e nome reais o bastante para a varredura de PII) e uma
  // transferência com correlationId conhecido; acima de R$ 10.000,00 para disparar fraude.
  const ids: string[] = [];
  for (const balance of [5_000_000, 0]) {
    const document = nextCpf();
    documents.push(document);
    const res = await apiFetch('/v1/accounts', {
      method: 'POST',
      body: JSON.stringify({ holderName: HOLDER, document, initialBalanceCents: balance }),
    });
    expect(res.status).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  const res = await apiFetch('/v1/transfers', {
    method: 'POST',
    headers: { 'idempotency-key': 'sys-1', 'x-correlation-id': 'c-obs-1' },
    body: JSON.stringify({
      sourceAccountId: ids[0],
      destinationAccountId: ids[1],
      amountCents: 1_000_000,
    }),
  });
  expect(res.status).toBe(201);
  transferId = ((await res.json()) as { id: string }).id;

  // Worker processou e os spans dos dois serviços chegaram ao coletor (lote a cada 1 s).
  await waitFor(() =>
    worker.logs.some((l) => l.msg === 'transfer.completed processed' && l.transferId === transferId)
      ? true
      : undefined,
  );
  await waitFor(() =>
    collector.spans.some((s) => s.name === 'transfer.completed process') ? true : undefined,
  );
}, 120_000);

afterAll(async () => {
  await Promise.all([stop(api), stop(worker)]);
  await new Promise((ok) => collector?.server.close(ok));
  await db?.drop();
});

describe('trace de ponta a ponta', () => {
  it('[OBS-AC-01] um traceId: span POST com correlationId, spans pg filhos e o processamento do worker', () => {
    const server = collector.spans.find(
      (s) => s.service === 'api' && s.attributes['app.correlation_id'] === 'c-obs-1',
    );
    expect(server?.name).toBe('POST /v1/transfers');
    expect(server?.attributes['http.route']).toBe('/v1/transfers');
    const traceId = server!.traceId;
    const inTrace = collector.spans.filter((s) => s.traceId === traceId);

    // Queries da requisição: spans pg da API cujo pai é o span de servidor.
    const pg = inTrace.filter((s) => s.service === 'api' && s.scope.includes('instrumentation-pg'));
    expect(pg.length).toBeGreaterThan(0);
    expect(pg.some((s) => s.parentSpanId === server!.spanId)).toBe(true);

    const processing = inTrace.find((s) => s.name === 'transfer.completed process');
    expect(processing?.service).toBe('worker');
    // Filho direto do span de servidor: o traceparent gravado no outbox é o dele.
    expect(processing?.parentSpanId).toBe(server!.spanId);
    expect(processing?.attributes['app.correlation_id']).toBe('c-obs-1');
    // As queries do worker também entram no mesmo trace.
    expect(inTrace.some((s) => s.service === 'worker' && s.scope.includes('pg'))).toBe(true);

    const workerLog = worker.logs.find(
      (l) => l.msg === 'transfer.completed processed' && l.transferId === transferId,
    );
    expect(workerLog).toMatchObject({ correlationId: 'c-obs-1', traceId });
  });

  it('[OBS-AC-01] o relay publica com um span próprio, ligado por link ao trace da requisição', () => {
    const server = collector.spans.find((s) => s.attributes['app.correlation_id'] === 'c-obs-1');
    const publish = collector.spans.find(
      (s) =>
        s.name === 'outbox publish' &&
        JSON.stringify((s.raw as { links?: unknown }).links ?? [])
          .toLowerCase()
          .includes(server!.traceId),
    );
    expect(publish?.service).toBe('api');
    expect(publish?.traceId).not.toBe(server!.traceId);
  });

  it('[OBS-AC-06] nenhum span tem CPF, nome do titular, API key ou parâmetros SQL', () => {
    const all = JSON.stringify(collector.spans.map((s) => s.raw));
    for (const document of documents) expect(all).not.toContain(document);
    expect(all).not.toContain(HOLDER);
    expect(all).not.toContain(KEY);
    for (const span of collector.spans) {
      for (const key of Object.keys(span.attributes)) {
        expect(key).not.toMatch(/parameter|values|db\.statement\.params/i);
      }
      const query = span.attributes['db.query.text'];
      if (typeof query === 'string') expect(query).not.toContain('1000000');
    }
  });
});

describe('métricas', () => {
  async function scrape(port: number): Promise<string> {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    return res.text();
  }

  function series(text: string): { name: string; labels: Record<string, string> }[] {
    return text
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s/.exec(l);
        const pairs = [...(match?.[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)];
        const labels: Record<string, string> = Object.fromEntries(
          pairs.map((m): [string, string] => [m[1] ?? '', m[2] ?? '']),
        );
        return { name: match?.[1] ?? '', labels };
      });
  }

  it('[OBS-AC-10] /metrics na porta própria; na porta da API é rota inexistente', async () => {
    const text = await scrape(apiMetricsPort);
    expect(text).toMatch(/^transfers_completed_total(\{[^}]*\})? 1$/m);
    expect(text).toContain('outbox_publish_lag_ms_bucket');
    expect(text).toContain('outbox_pending');
    const viaApi = await apiFetch('/metrics');
    expect(viaApi.status).toBe(404);
    expect(await viaApi.json()).toMatchObject({ code: 'ROUTE_NOT_FOUND' });
  });

  it('[OBS-AC-07] contagem de transferências no Prometheus da API', async () => {
    const text = await scrape(apiMetricsPort);
    expect(text).toMatch(/^transfers_completed_total(\{[^}]*\})? 1$/m);
  });

  it('[OBS-AC-09] métricas de aplicação só com reason/rule/outcome; nenhum valor parece UUID', async () => {
    const all = [
      ...series(await scrape(apiMetricsPort)),
      ...series(await scrape(workerMetricsPort)),
    ];
    const app = /^(transfers_|outbox_|fraud_|worker_)/;
    expect(all.some((s) => s.name.startsWith('worker_processing_ms'))).toBe(true);
    expect(
      all.some((s) => s.name === 'fraud_flagged_total' && s.labels.rule === 'HIGH_AMOUNT'),
    ).toBe(true);
    for (const s of all) {
      for (const value of Object.values(s.labels)) expect(value).not.toMatch(UUID);
      if (!app.test(s.name)) continue;
      for (const key of Object.keys(s.labels))
        expect(['reason', 'rule', 'outcome', 'le']).toContain(key);
    }
  });
});

describe('coletor fora do ar', () => {
  it('[OBS-AC-14] API com endpoint OTLP recusando conexões atende normalmente', async () => {
    const port = await freePort();
    const deadCollector = await freePort(); // ninguém escuta aqui
    const proc = startProcess(
      'api',
      {
        ...baseEnv,
        PORT: String(port),
        API_KEYS: `web:${KEY}`,
        API_DB_USER: decodeURIComponent(new URL(db.url).username),
        API_DB_PASSWORD: decodeURIComponent(new URL(db.url).password),
        OUTBOX_RELAY_ENABLED: 'false',
        OTEL_SERVICE_NAME: 'api-no-collector',
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${deadCollector}`,
      },
      'api listening',
    );
    try {
      await proc.bootMs;
      const created = await apiFetch(
        '/v1/accounts',
        {
          method: 'POST',
          body: JSON.stringify({
            holderName: 'Sem Coletor',
            document: nextCpf(),
            initialBalanceCents: 0,
          }),
        },
        port,
      );
      expect(created.status).toBe(201);
      // Dá tempo de o lote de spans tentar (e falhar) o envio.
      await new Promise((r) => setTimeout(r, 1_500));
      const again = await apiFetch('/health/ready', {}, port);
      expect(again.status).toBe(200);
      const requests = proc.logs.filter((l) => l.msg === 'request completed');
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.every((l) => l.level === 'info')).toBe(true);
    } finally {
      await stop(proc);
    }
  });
});
