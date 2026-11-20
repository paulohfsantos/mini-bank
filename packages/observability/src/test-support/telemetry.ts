// SDK do OpenTelemetry em memória para testes: spans e métricas sem coletor nem rede.
// Sem instrumentações automáticas (no Vitest os módulos não passam pelo loader); os spans
// vêm dos helpers manuais (`withConsumerSpan` etc.) ou de `tracer().startActiveSpan`.
import {
  type Attributes,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import {
  AggregationTemporality,
  type DataPoint,
  type Histogram,
  MetricReader,
  type MetricData,
} from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, type ReadableSpan } from '@opentelemetry/sdk-trace';
import { startTelemetry } from '../telemetry/sdk';

class CollectingReader extends MetricReader {
  constructor() {
    super({ aggregationTemporalitySelector: () => AggregationTemporality.CUMULATIVE });
  }
  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface TestTelemetry {
  /** Spans terminados até agora (força o flush do lote). */
  spans(): Promise<ReadableSpan[]>;
  /** Métricas coletadas agora, achatadas por nome. */
  metrics(): Promise<MetricData[]>;
  /** Soma de um counter (ou contagem de um histogram) com os atributos dados. */
  value(name: string, attributes?: Attributes): Promise<number>;
  shutdown(): Promise<void>;
}

function matches(point: DataPoint<unknown>, attributes: Attributes): boolean {
  return Object.entries(attributes).every(([k, v]) => point.attributes[k] === v);
}

export function startTestTelemetry(serviceName = 'test'): TestTelemetry {
  const exporter = new InMemorySpanExporter();
  const reader = new CollectingReader();
  const telemetry = startTelemetry({
    serviceName,
    spanExporter: exporter,
    metricReaders: [reader],
    instrument: false,
  });

  const collect = async () => {
    const { resourceMetrics } = await reader.collect();
    return resourceMetrics.scopeMetrics.flatMap((s) => s.metrics);
  };

  return {
    async spans() {
      await telemetry.forceFlush();
      return exporter.getFinishedSpans();
    },
    metrics: collect,
    async value(name, attributes = {}) {
      const metric = (await collect()).find((m) => m.descriptor.name === name);
      if (!metric) return 0;
      return (metric.dataPoints as DataPoint<unknown>[])
        .filter((p) => matches(p, attributes))
        .reduce((sum, p) => {
          const v = p.value;
          return sum + (typeof v === 'number' ? v : (v as Histogram).count);
        }, 0);
    },
    shutdown: () => telemetry.shutdown(),
  };
}

/**
 * Simula o span de servidor que a instrumentação http criaria (no Vitest os módulos não
 * passam pelo loader): SERVER, filho do `traceparent` do cliente quando houver.
 */
export async function withServerSpan<T>(
  name: string,
  options: { traceparent?: string },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = options.traceparent
    ? propagation.extract(ROOT_CONTEXT, { traceparent: options.traceparent })
    : ROOT_CONTEXT;
  return trace
    .getTracer('test-http')
    .startActiveSpan(name, { kind: SpanKind.SERVER }, parent, async (span) => {
      try {
        return await fn(span);
      } finally {
        span.end();
      }
    });
}
