// Métricas de aplicação (OBS-BR-07). Catálogo fechado e atributos só de conjuntos
// fechados (OBS-BR-08, PERF-25): os tipos abaixo impedem passar um id por engano.
// Só a API do OpenTelemetry: sem MeterProvider registrado, tudo vira no-op.
import { type Meter, type MeterProvider, metrics } from '@opentelemetry/api';
import type { ErrorCode } from '@mini-banco/contracts';

export type FraudRuleName = 'HIGH_AMOUNT' | 'HIGH_VELOCITY';
export type ProcessingOutcome = 'processed' | 'duplicate' | 'retry' | 'reject';

/** Chaves de atributo permitidas em métricas de aplicação (OBS-AC-09). */
export const METRIC_ATTRIBUTE_KEYS = ['reason', 'rule', 'outcome'] as const;

// Milissegundos: do processamento típico (poucos ms) ao pior caso do visibility timeout.
const MS_BUCKETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000];
const LAG_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000, 60_000];

function instruments(meter: Meter) {
  return {
    transfersCompleted: meter.createCounter('transfers_completed', {
      description: 'Transferências novas concluídas (replay idempotente não conta)',
    }),
    transfersRejected: meter.createCounter('transfers_rejected', {
      description: 'POST /v1/transfers respondido com erro, por code do problem+json',
    }),
    outboxPublishLag: meter.createHistogram('outbox_publish_lag_ms', {
      description: 'Tempo entre a gravação no outbox e a publicação no SQS',
      advice: { explicitBucketBoundaries: LAG_BUCKETS },
    }),
    outboxPending: meter.createObservableGauge('outbox_pending', {
      description: 'Linhas do outbox ainda não publicadas',
    }),
    fraudFlagged: meter.createCounter('fraud_flagged', {
      description: 'Regras antifraude disparadas em revisões FLAGGED',
    }),
    workerProcessing: meter.createHistogram('worker_processing_ms', {
      description: 'Duração do processamento de cada mensagem pelo worker',
      advice: { explicitBucketBoundaries: MS_BUCKETS },
    }),
  };
}

type Instruments = ReturnType<typeof instruments>;

// Instrumentos criados sob demanda e por MeterProvider: a API de métricas não tem proxy,
// então criá-los antes do registro do provider os deixaria no-op para sempre.
const cache = new WeakMap<MeterProvider, Instruments>();
function get(): Instruments {
  const provider = metrics.getMeterProvider();
  let found = cache.get(provider);
  if (!found) {
    found = instruments(provider.getMeter('mini-banco'));
    cache.set(provider, found);
  }
  return found;
}

export const appMetrics = {
  transferCompleted(): void {
    get().transfersCompleted.add(1);
  },
  transferRejected(reason: ErrorCode): void {
    get().transfersRejected.add(1, { reason });
  },
  outboxPublished(lagMs: number): void {
    get().outboxPublishLag.record(Math.max(0, lagMs));
  },
  fraudFlagged(rules: readonly FraudRuleName[]): void {
    for (const rule of rules) get().fraudFlagged.add(1, { rule });
  },
  workerProcessed(outcome: ProcessingOutcome, durationMs: number): void {
    get().workerProcessing.record(durationMs, { outcome });
  },
  /**
   * Gauge lido na coleta. `read` devolve undefined quando não conseguiu medir (ex.: banco
   * fora): a coleta segue sem observação. Devolve a função que remove o callback.
   */
  observeOutboxPending(read: () => Promise<number | undefined>): () => void {
    const gauge = get().outboxPending;
    const callback = async (result: { observe(value: number): void }) => {
      const value = await read().catch(() => undefined);
      if (value !== undefined) result.observe(value);
    };
    gauge.addCallback(callback);
    return () => gauge.removeCallback(callback);
  },
};
