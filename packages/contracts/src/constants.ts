// Limites de negócio compartilhados por API, worker e front.
// Mudou aqui? Mude antes a spec e o openapi.yaml (fluxo SDD).

/** TRF-BR-01: teto por transferência, em centavos (R$ 1.000.000,00). */
export const MAX_TRANSFER_CENTS = 100_000_000;

/** ACC-BR-03: teto do saldo inicial, em centavos (R$ 100.000,00). */
export const MAX_INITIAL_BALANCE_CENTS = 10_000_000;

/** ACC-BR-04: tamanho máximo do nome do titular. */
export const MAX_HOLDER_NAME_LENGTH = 120;

/** STM-BR-05: paginação do extrato. */
export const STATEMENT_DEFAULT_LIMIT = 20;
export const STATEMENT_MAX_LIMIT = 100;

/** TRF-BR-07 e TRF-BR-14: formato de headers aceitos. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Nomes de headers HTTP usados pelo contrato. */
export const HEADERS = {
  apiKey: 'x-api-key',
  correlationId: 'x-correlation-id',
  idempotencyKey: 'idempotency-key',
  idempotentReplayed: 'idempotent-replayed',
  retryAfter: 'retry-after',
} as const;
