import { SpanKind, trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runWithCorrelationId } from '../correlation';
import { createLogger } from '../logger';
import { MemoryStream } from '../test-support/memory-stream';
import { startTestTelemetry, type TestTelemetry } from '../test-support/telemetry';
import {
  currentTraceparent,
  withConsumerSpan,
  withoutAutoInstrumentation,
  withProducerSpan,
} from './tracing';

const T = '4bf92f3577b34da6a3ce929d0e0e4736';
const S = '00f067aa0ba902b7';
const TRACEPARENT = `00-${T}-${S}-01`;

let telemetry: TestTelemetry;
beforeEach(() => {
  telemetry = startTestTelemetry();
});
afterEach(async () => {
  await telemetry.shutdown();
});

describe('logs com traceId e spanId', () => {
  it('[OBS-AC-05] dentro de um span, a linha traz traceId e spanId do span', () => {
    const stream = new MemoryStream();
    const logger = createLogger({ service: 'api', destination: stream });
    let ids: { traceId: string; spanId: string } | undefined;
    trace.getTracer('t').startActiveSpan('s', (span) => {
      ids = span.spanContext();
      logger.info('dentro');
      span.end();
    });
    logger.info('fora');
    expect(stream.lines[0]).toMatchObject({ traceId: ids?.traceId, spanId: ids?.spanId });
    expect(ids?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ids?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(stream.lines[1]).not.toHaveProperty('traceId');
    expect(stream.lines[1]).not.toHaveProperty('spanId');
  });

  it('[OBS-AC-05] o span ativo tem precedência sobre o traceId do contexto de correlação', async () => {
    const stream = new MemoryStream();
    const logger = createLogger({ service: 'worker', destination: stream });
    await runWithCorrelationId(
      'c-1',
      () =>
        withConsumerSpan('x', {}, (span) => {
          logger.info('ok');
          expect(stream.lines[0]?.traceId).toBe(span.spanContext().traceId);
          return Promise.resolve();
        }),
      { traceId: 'f'.repeat(32) },
    );
  });
});

describe('withConsumerSpan', () => {
  it('[OBS-AC-04] continua o trace do traceparent: mesmo trace id, parent = span do attribute', async () => {
    await withConsumerSpan('transfer.completed process', { traceparent: TRACEPARENT }, () =>
      Promise.resolve(),
    );
    const [span] = await telemetry.spans();
    expect(span?.name).toBe('transfer.completed process');
    expect(span?.kind).toBe(SpanKind.CONSUMER);
    expect(span?.spanContext().traceId).toBe(T);
    expect(span?.parentSpanContext?.spanId).toBe(S);
  });

  it.each([
    ['ausente', undefined],
    ['malformado', 'lixo'],
    ['trace id zerado', `00-${'0'.repeat(32)}-${S}-01`],
  ])('[OBS-AC-04] traceparent %s → raiz de um trace novo', async (_caso, traceparent) => {
    const result = await withConsumerSpan('p', traceparent ? { traceparent } : {}, () =>
      Promise.resolve('processado'),
    );
    const [span] = await telemetry.spans();
    expect(result).toBe('processado');
    expect(span?.parentSpanContext).toBeUndefined();
    expect(span?.spanContext().traceId).not.toBe(T);
  });

  it('[OBS-BR-05] erro marca o span sem guardar o objeto de erro', async () => {
    const error = Object.assign(new Error('falhou'), { detail: 'Key (document)=(52998224725)' });
    await expect(withConsumerSpan('p', {}, () => Promise.reject(error))).rejects.toBe(error);
    const [span] = await telemetry.spans();
    expect(span?.status.code).toBe(2); // ERROR
    expect(JSON.stringify(span?.events)).not.toContain('52998224725');
  });
});

describe('withProducerSpan', () => {
  it('[OBS-AC-02] span raiz com link para cada traceparent válido do lote', async () => {
    const other = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;
    await trace.getTracer('t').startActiveSpan('pai', async (parent) => {
      await withProducerSpan(
        'outbox publish',
        { linkedTraceparents: [TRACEPARENT, null, 'lixo', other] },
        () => Promise.resolve(),
      );
      parent.end();
    });
    const span = (await telemetry.spans()).find((s) => s.name === 'outbox publish');
    expect(span?.kind).toBe(SpanKind.PRODUCER);
    expect(span?.parentSpanContext).toBeUndefined();
    expect(span?.links.map((l) => l.context.traceId)).toEqual([T, 'a'.repeat(32)]);
  });
});

describe('currentTraceparent', () => {
  it('[OBS-AC-03] devolve o traceparent do span ativo e undefined fora de span', () => {
    expect(currentTraceparent()).toBeUndefined();
    trace.getTracer('t').startActiveSpan('s', (span) => {
      const { traceId, spanId } = span.spanContext();
      expect(currentTraceparent()).toBe(`00-${traceId}-${spanId}-01`);
      span.end();
    });
  });

  it('[OBS-AC-02] sem instrumentação automática não há contexto para propagar', () => {
    trace.getTracer('t').startActiveSpan('s', (span) => {
      expect(withoutAutoInstrumentation(() => currentTraceparent())).toBeUndefined();
      span.end();
    });
  });
});
