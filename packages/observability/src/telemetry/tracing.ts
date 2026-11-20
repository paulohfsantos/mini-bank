// Helpers de trace usados pelos apps. Só a API do OpenTelemetry (`@opentelemetry/api`):
// sem SDK registrado (testes, OTEL_SDK_DISABLED) tudo vira no-op.
import {
  type Attributes,
  context,
  type Context,
  type Link,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';

const TRACER = 'mini-banco';

/** Atributo com o id de negócio da requisição (OBS-BR-03/04): busca no Jaeger por `app.correlation_id`. */
export const ATTR_CORRELATION_ID = 'app.correlation_id';

function tracer() {
  return trace.getTracer(TRACER);
}

/**
 * Contexto vindo só do `traceparent` (a partir da raiz): inválido ou ausente → raiz, nunca
 * o span ativo por acaso no processo.
 */
function contextFrom(traceparent: string | undefined): Context {
  return traceparent ? propagation.extract(ROOT_CONTEXT, { traceparent }) : ROOT_CONTEXT;
}

/** `traceparent` W3C do contexto ativo; undefined sem span válido (ex.: SDK desligado). */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

/** traceId/spanId do span ativo (OBS-BR-06); undefined fora de span. */
export function activeSpanIds(): { traceId: string; spanId: string } | undefined {
  const span = trace.getActiveSpan();
  if (!span?.isRecording()) return undefined;
  const { traceId, spanId } = span.spanContext();
  return { traceId, spanId };
}

/** Atributos no span ativo (ex.: o span de servidor do http). */
export function setActiveSpanAttributes(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes);
}

/** Renomeia o span ativo (o interceptor da API usa `METHOD /rota`). */
export function renameActiveSpan(name: string): void {
  trace.getActiveSpan()?.updateName(name);
}

async function runInSpan<T>(span: Span, fn: (span: Span) => Promise<T>): Promise<T> {
  try {
    return await fn(span);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    // Só nome e mensagem: nunca o objeto de erro do pg, que pode trazer valores (OBS-BR-05).
    span.recordException({ name: err.name, message: err.message });
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.name });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * OBS-BR-04: span CONSUMER filho do `traceparent` da mensagem. Ausente ou malformado →
 * raiz de um trace novo (o propagador W3C ignora valores inválidos).
 */
export function withConsumerSpan<T>(
  name: string,
  options: { traceparent?: string; attributes?: Attributes },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = contextFrom(options.traceparent);
  return tracer().startActiveSpan(
    name,
    { kind: SpanKind.CONSUMER, ...(options.attributes ? { attributes: options.attributes } : {}) },
    parent,
    (span) => runInSpan(span, fn),
  );
}

/**
 * OBS-BR-04: span PRODUCER raiz com *links* para os traces dos eventos do lote (um lote
 * mistura traces diferentes, então nenhum deles é o pai).
 */
export function withProducerSpan<T>(
  name: string,
  options: { linkedTraceparents: readonly (string | null | undefined)[]; attributes?: Attributes },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const links: Link[] = options.linkedTraceparents.flatMap((tp) => {
    const spanContext = tp ? trace.getSpanContext(contextFrom(tp)) : undefined;
    return spanContext ? [{ context: spanContext }] : [];
  });
  return tracer().startActiveSpan(
    name,
    {
      kind: SpanKind.PRODUCER,
      links,
      root: true,
      ...(options.attributes ? { attributes: options.attributes } : {}),
    },
    (span) => runInSpan(span, fn),
  );
}

/**
 * Executa sem instrumentação automática. O relay envia ao SQS assim: a instrumentação do
 * aws-sdk sobrescreveria o attribute `traceparent` gravado no outbox pelo do próprio envio.
 * Também usado no long polling do worker (um span a cada 20 s, sem valor).
 */
export function withoutAutoInstrumentation<T>(fn: () => T): T {
  return context.with(suppressTracing(context.active()), fn);
}
