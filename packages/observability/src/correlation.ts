// Contexto de correlação por requisição/mensagem (ADR-0011).
// AsyncLocalStorage propaga o valor através de await, timers e callbacks sem passá-lo
// por parâmetro, e isola requisições concorrentes umas das outras.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { CORRELATION_ID_PATTERN } from '@mini-banco/contracts';

interface CorrelationContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * TRF-BR-14 / SEC-12: aceita só 1–64 caracteres `[A-Za-z0-9-]`; qualquer outra coisa
 * (ausente, gigante, com quebra de linha, header repetido) vira um UUID novo.
 */
export function resolveCorrelationId(header: string | string[] | undefined): string {
  return typeof header === 'string' && CORRELATION_ID_PATTERN.test(header) ? header : randomUUID();
}

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
