// SDK do OpenTelemetry (ADR-0010, OBS-BR-01). Montado à mão, sem @opentelemetry/sdk-node
// nem auto-instrumentações: só http, pg e aws-sdk (PERF-05). A instrumentação do Nest
// (instrumentation-nestjs-core) ainda não suporta o Nest 12; o nome da rota no span de
// servidor vem de um interceptor da API (`route-span.interceptor.ts`).
// Quem chama é `register.ts` (via `node --import`), antes de qualquer módulo da aplicação.
import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { type MetricReader, MeterProvider } from '@opentelemetry/sdk-metrics';
import {
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  type SpanExporter,
  type SpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { getTelemetry, setTelemetry, type Telemetry } from './global';

export type { Telemetry } from './global';

/** Módulos que as instrumentações abaixo corrigem: o loader ESM só intercepta estes. */
export const INSTRUMENTED_MODULES = [
  'pg',
  'pg-pool',
  '@smithy/middleware-stack',
  '@smithy/smithy-client',
  '@aws-sdk/middleware-stack',
  '@aws-sdk/smithy-client',
];

/** Requisições sem trace: health checks do ALB/ECS e scrape de métricas (ruído, sem valor). */
const UNTRACED_PATHS = /^\/(health|metrics)(\/|$|\?)/;

export interface TelemetryOptions {
  serviceName: string;
  /** Padrão: OTLP/HTTP em `OTEL_EXPORTER_OTLP_ENDPOINT` (ou localhost:4318). Testes passam o seu. */
  spanExporter?: SpanExporter;
  /** OBS-BR-09: porta do exporter Prometheus; ausente = sem servidor de métricas. */
  metricsPort?: number;
  /** Leitores extras (testes). */
  metricReaders?: MetricReader[];
  /** Padrão true. Testes unitários desligam (não há módulos para corrigir). */
  instrument?: boolean;
}

export function startTelemetry(options: TelemetryOptions): Telemetry {
  const existing = getTelemetry();
  if (existing) return existing;

  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName });

  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());

  // OBS-BR-02: lote assíncrono; exportar nunca bloqueia nem falha uma requisição.
  const spanProcessors: SpanProcessor[] = [
    new BatchSpanProcessor({
      exporter: options.spanExporter ?? new OTLPTraceExporter({ timeoutMillis: 5_000 }),
      scheduledDelayMillis: 1_000,
      exportTimeoutMillis: 5_000,
      maxQueueSize: 2_048,
    }),
  ];
  const tracerProvider = new TracerProvider({
    resource,
    // OBS-NFR-02: local 100%; na AWS a taxa entra por um sampler configurável (fase 8).
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    spanProcessors,
  });
  trace.setGlobalTracerProvider(tracerProvider);

  const readers: MetricReader[] = [...(options.metricReaders ?? [])];
  if (options.metricsPort !== undefined) {
    // Só loopback: /metrics é para o dev local (na AWS as métricas saem por EMF, fase 8).
    readers.push(
      new PrometheusExporter({
        host: '127.0.0.1',
        port: options.metricsPort,
        withoutScopeInfo: true,
      }),
    );
  }
  const meterProvider = new MeterProvider({ resource, readers });
  metrics.setGlobalMeterProvider(meterProvider);

  const disableInstrumentations =
    options.instrument === false
      ? () => undefined
      : registerInstrumentations({
          tracerProvider,
          meterProvider,
          instrumentations: [
            new HttpInstrumentation({
              ignoreIncomingRequestHook: (req) => UNTRACED_PATHS.test(req.url ?? '/'),
              // Só o exporter OTLP e o SQS saem por HTTP; o SQS já tem span próprio.
              disableOutgoingRequestInstrumentation: true,
            }),
            // requireParentSpan: o relay consulta o outbox a cada 1 s; sem isso, cada
            // consulta viraria um trace raiz. Valores de parâmetros nunca entram (OBS-BR-05).
            new PgInstrumentation({ requireParentSpan: true, enhancedDatabaseReporting: false }),
            new AwsInstrumentation({ suppressInternalInstrumentation: true }),
          ],
        });

  const telemetry: Telemetry = {
    forceFlush: () => tracerProvider.forceFlush(),
    async shutdown(timeoutMs = 5_000) {
      disableInstrumentations();
      const done = Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
      await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
      setTelemetry(undefined);
      trace.disable();
      metrics.disable();
      propagation.disable();
      context.disable();
    },
  };
  setTelemetry(telemetry);
  return telemetry;
}
