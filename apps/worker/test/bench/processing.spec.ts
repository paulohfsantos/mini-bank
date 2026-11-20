// PERF-18 / PRC-NFR-01: mede o processamento do worker sob carga e confere o visibility
// timeout. Fora do CI (resultado depende da máquina): `pnpm bench`.
//
// Ressalva: o Postgres de teste roda com fsync=off, então os números são otimistas em
// relação ao RDS. Na AWS, repetir a medição com Logs Insights sobre `durationMs` e
// `inFlightMs` (fase 8).
import 'reflect-metadata';
import { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { NestFactory } from '@nestjs/core';
import { createTestDatabase } from '@mini-banco/database/testing';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { createLogger } from '@mini-banco/observability';
import { MemoryStream } from '@mini-banco/observability/testing';
import pg from 'pg';
import { describe, expect, inject, it } from 'vitest';
import { WorkerModule } from '../../src/worker.module';

const EVENTS = 500;
const ACCOUNTS = 50;
const VISIBILITY_TIMEOUT_MS = 30_000; // docs/aws.md §2.2 e infra/local/elasticmq.conf

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)]!;
}

function summary(values: number[]) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
    max: Math.max(...values),
  };
}

describe('desempenho do worker', () => {
  it('[PRC-NFR-01] [PERF-18] 500 eventos: p95 < 200 ms e visibility timeout ≥ 6× o p99', async () => {
    const db = await createTestDatabase(inject('pgAdminUrl'), {
      role: 'mini_banco_worker',
      max: 5,
    });
    const owner = new pg.Pool({ connectionString: db.url, max: 3 });
    const sqs = createTestSqsClient(inject('sqsEndpoint'));
    const { queueUrl } = await createTestQueues(sqs);
    const logs = new MemoryStream();

    try {
      // 50 contas, 500 transferências espalhadas na última hora: a consulta de velocidade
      // (índice transfers_source_created_idx) trabalha com histórico real por conta.
      await owner.query(
        `INSERT INTO accounts (id, holder_name, document, balance_cents)
         SELECT gen_random_uuid(), 'Bench ' || g, lpad(g::text, 11, '0'), 0
           FROM generate_series(1, $1::int) AS g`,
        [ACCOUNTS],
      );
      const { rows: transfers } = await owner.query<{
        id: string;
        source: string;
        destination: string;
        amount: string;
        created_at: Date;
      }>(
        `WITH a AS (SELECT id, row_number() OVER (ORDER BY id) AS n FROM accounts)
         INSERT INTO transfers (id, source_account_id, destination_account_id, amount_cents, status, correlation_id, created_at)
         SELECT gen_random_uuid(), s.id, d.id, 100 + (g * 7919) % 2000000, 'COMPLETED', 'bench',
                now() - (g % 3600) * interval '1 second'
           FROM generate_series(1, $1::int) AS g
           JOIN a s ON s.n = 1 + g % $2::int
           JOIN a d ON d.n = 1 + (g + 1) % $2::int
         RETURNING id, source_account_id AS source, destination_account_id AS destination,
                   amount_cents::text AS amount, created_at`,
        [EVENTS, ACCOUNTS],
      );
      await owner.query('ANALYZE transfers');

      for (let i = 0; i < transfers.length; i += 10) {
        await sqs.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: transfers.slice(i, i + 10).map((t, j) => ({
              Id: `m${j}`,
              MessageBody: JSON.stringify({
                eventId: crypto.randomUUID(),
                eventType: 'transfer.completed',
                eventVersion: 1,
                occurredAt: t.created_at.toISOString(),
                correlationId: 'bench',
                data: {
                  transferId: t.id,
                  sourceAccountId: t.source,
                  destinationAccountId: t.destination,
                  amountCents: Number(t.amount),
                  completedAt: t.created_at.toISOString(),
                },
              }),
            })),
          }),
        );
      }

      const startedAt = performance.now();
      const app = await NestFactory.createApplicationContext(
        WorkerModule.forRoot({
          pool: db.pool,
          sqs,
          queueUrl,
          logger: createLogger({ service: 'worker', level: 'debug', destination: logs }),
          consumer: { concurrency: 5, waitTimeSeconds: 1, maxMessages: 10 },
          ownsResources: false,
        }),
        { logger: false },
      );
      try {
        for (;;) {
          const { rows } = await owner.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM processed_messages',
          );
          if (rows[0]!.n >= EVENTS) break;
          if (performance.now() - startedAt > 240_000) throw new Error('worker não terminou');
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        await app.close();
      }
      const elapsedMs = performance.now() - startedAt;

      const processing = summary(
        logs.lines
          .filter((l) => l.msg === 'transfer.completed processed')
          .map((l) => Number(l.durationMs)),
      );
      const inFlight = summary(
        logs.lines.filter((l) => l.msg === 'message acknowledged').map((l) => Number(l.inFlightMs)),
      );
      const result = {
        events: EVENTS,
        throughputPerSecond: Math.round(EVENTS / (elapsedMs / 1000)),
        processingMs: processing,
        inFlightMs: inFlight,
        visibilityTimeoutMs: VISIBILITY_TIMEOUT_MS,
        headroom: Math.floor(VISIBILITY_TIMEOUT_MS / inFlight.p99),
      };
      process.stdout.write(`\nPERF-18 ${JSON.stringify(result, null, 2)}\n`);

      expect(processing.n).toBe(EVENTS);
      expect(processing.p95).toBeLessThan(200); // PRC-NFR-01
      // PERF-18: o que precisa caber no timeout é o tempo invisível até o ack (inFlight).
      expect(VISIBILITY_TIMEOUT_MS).toBeGreaterThanOrEqual(6 * inFlight.p99);
    } finally {
      sqs.destroy();
      await owner.end();
      await db.drop();
    }
  });
});
