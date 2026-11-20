import { createLogger } from '@mini-banco/observability';
import { MemoryStream } from '@mini-banco/observability/testing';
import { describe, expect, it } from 'vitest';
import { TransferMismatchError } from '../domain/errors';
import { mapWithConcurrency } from './concurrency';
import {
  backoffSeconds,
  classify,
  messageCorrelationId,
  TransferCompletedHandler,
} from './message-handler';
import type { ProcessTransferCompletedUseCase } from './process-transfer-completed';

const validBody = JSON.stringify({
  eventId: '0193a1b2-7c4d-7e5f-8a6b-1c2d3e4f5a6b',
  eventType: 'transfer.completed',
  eventVersion: 1,
  occurredAt: '2026-11-18T14:03:21.512Z',
  correlationId: 'c-123',
  data: {
    transferId: '0193a1b2-7c4d-7e5f-8a6b-000000000001',
    sourceAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000aa',
    destinationAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000bb',
    amountCents: 15000,
    completedAt: '2026-11-18T14:03:21.498Z',
  },
});

function handlerWith(execute: () => Promise<unknown>) {
  const stream = new MemoryStream();
  const logger = createLogger({ service: 'worker', level: 'info', destination: stream });
  const useCase = { execute } as unknown as ProcessTransferCompletedUseCase;
  return { handler: new TransferCompletedHandler(useCase, logger), stream };
}

describe('TransferCompletedHandler', () => {
  it('[PRC-BR-08] processado ou duplicado → delete', async () => {
    const { handler } = handlerWith(() => Promise.resolve({ outcome: 'duplicate' }));
    expect(await handler.handle({ body: validBody, receiveCount: 1 })).toEqual({
      action: 'delete',
    });
  });

  it.each([
    ['JSON inválido', '{nope'],
    ['schema errado', '{"foo":1}'],
  ])(
    '[PRC-AC-05] %s → reject (não retentável), log ERROR com os erros de validação, sem chamar o use case',
    async (_c, body) => {
      let called = false;
      const { handler, stream } = handlerWith(() => {
        called = true;
        return Promise.resolve({ outcome: 'duplicate' });
      });
      expect(await handler.handle({ body, receiveCount: 1 })).toEqual({ action: 'reject' });
      expect(called).toBe(false);
      const line = stream.lines.find((l) => l.level === 'error');
      expect(line).toMatchObject({ kind: 'INVALID_PAYLOAD' });
      expect((line?.issues as unknown[]).length).toBeGreaterThan(0);
      expect(stream.raw).not.toContain('"foo":1'); // não loga o corpo
    },
  );

  it('[PRC-AC-08] divergência com o banco → reject e log de segurança (SEC-14)', async () => {
    const { handler, stream } = handlerWith(() =>
      Promise.reject(
        new TransferMismatchError('0193a1b2-7c4d-7e5f-8a6b-000000000001', ['amountCents']),
      ),
    );
    expect(await handler.handle({ body: validBody, receiveCount: 1 })).toEqual({
      action: 'reject',
    });
    expect(stream.lines.find((l) => l.level === 'error')).toMatchObject({
      security: true,
      kind: 'TRANSFER_MISMATCH',
      fields: ['amountCents'],
    });
  });

  it('[PRC-AC-06] erro transitório → retry com backoff exponencial pelo receiveCount', async () => {
    const { handler } = handlerWith(() =>
      Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
    );
    expect(await handler.handle({ body: validBody, receiveCount: 1 })).toEqual({
      action: 'retry',
      visibilityTimeoutSeconds: 5,
    });
    expect(await handler.handle({ body: validBody, receiveCount: 3 })).toEqual({
      action: 'retry',
      visibilityTimeoutSeconds: 20,
    });
  });
});

describe('backoff e classificação (PRC-BR-09)', () => {
  it('5 s, 10 s, 20 s, 40 s ... com teto', () => {
    const options = { baseSeconds: 5, maxSeconds: 300 };
    expect([1, 2, 3, 4, 10].map((n) => backoffSeconds(n, options))).toEqual([5, 10, 20, 40, 300]);
  });

  it('só erros do domínio marcados como não retentáveis vão rápido para a DLQ', () => {
    expect(classify(new TransferMismatchError('x', ['missing']))).toBe('non-retryable');
    expect(classify(new Error('timeout'))).toBe('retryable');
    expect(classify('qualquer coisa')).toBe('retryable');
  });
});

describe('messageCorrelationId (PRC-BR-10)', () => {
  it('usa o attribute; sem ele, o do corpo; inválidos são ignorados', () => {
    expect(messageCorrelationId('c-attr', validBody)).toBe('c-attr');
    expect(messageCorrelationId(undefined, validBody)).toBe('c-123');
    expect(messageCorrelationId('com espaço', validBody)).toBe('c-123');
    expect(messageCorrelationId(undefined, '{nope')).toBeUndefined();
  });
});

describe('mapWithConcurrency', () => {
  it('[PRC-NFR-02] nunca passa do limite e devolve na ordem, com falhas isoladas', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      if (n === 3) throw new Error('falhou');
      return n * 2;
    });
    expect(peak).toBe(5);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 2 });
    expect(results[2]?.status).toBe('rejected');
    expect(results).toHaveLength(10);
  });
});
