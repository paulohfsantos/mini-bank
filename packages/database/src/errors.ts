// Tradução de erros do Postgres que a aplicação trata de forma específica.
// Qualquer outro erro sobe como está e vira 500 genérico na borda (SEC-13).

/** Códigos SQLSTATE usados pelo projeto. */
export const PgErrorCode = {
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  lockNotAvailable: '55P03',
  queryCanceled: '57014',
} as const;

/**
 * `lock_timeout` estourou (55P03): outro processo segura o lock. A aplicação decide o
 * significado pelo passo em que ocorreu (chave de idempotência → 409, conta → 503).
 */
export class ResourceBusyError extends Error {
  override readonly name = 'ResourceBusyError';
  constructor(options?: { cause?: unknown }) {
    super('lock not available within lock_timeout', options);
  }
}

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
}

function asPgError(error: unknown): PgErrorLike | undefined {
  return typeof error === 'object' && error !== null ? error : undefined;
}

export function pgErrorCode(error: unknown): string | undefined {
  const code = asPgError(error)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Violação de UNIQUE, opcionalmente de uma constraint específica. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (pgErrorCode(error) !== PgErrorCode.uniqueViolation) return false;
  return constraint === undefined || asPgError(error)?.constraint === constraint;
}

export function translatePgError(error: unknown): unknown {
  if (error instanceof ResourceBusyError) return error;
  if (pgErrorCode(error) === PgErrorCode.lockNotAvailable) {
    return new ResourceBusyError({ cause: error });
  }
  return error;
}
