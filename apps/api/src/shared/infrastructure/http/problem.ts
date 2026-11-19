// Erros em application/problem+json (RFC 9457) com `code` estável (contrato).
import type { ServerResponse } from 'node:http';
import { type ErrorCode, HEADERS, type Problem } from '@mini-banco/contracts';
import { getCorrelationId } from '@mini-banco/observability';
import type { DomainErrorCode } from '../../domain/errors';

/** Status por code. `satisfies` garante um status para cada code do contrato. */
export const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  INVALID_DOCUMENT: 400,
  INVALID_CURSOR: 400,
  SAME_ACCOUNT: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  UNAUTHORIZED: 401,
  ACCOUNT_NOT_FOUND: 404,
  TRANSFER_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  DOCUMENT_ALREADY_REGISTERED: 409,
  REQUEST_IN_PROGRESS: 409,
  PAYLOAD_TOO_LARGE: 413,
  IDEMPOTENCY_KEY_REUSED: 422,
  INSUFFICIENT_FUNDS: 422,
  ACCOUNT_BUSY: 503,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

const TITLE_BY_CODE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Requisição inválida',
  INVALID_DOCUMENT: 'CPF inválido',
  INVALID_CURSOR: 'Cursor inválido',
  SAME_ACCOUNT: 'Origem e destino iguais',
  IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key obrigatória',
  IDEMPOTENCY_KEY_INVALID: 'Idempotency-Key inválida',
  UNAUTHORIZED: 'Não autenticado',
  ACCOUNT_NOT_FOUND: 'Conta não encontrada',
  TRANSFER_NOT_FOUND: 'Transferência não encontrada',
  ROUTE_NOT_FOUND: 'Rota não encontrada',
  DOCUMENT_ALREADY_REGISTERED: 'Documento já cadastrado',
  REQUEST_IN_PROGRESS: 'Requisição em andamento',
  PAYLOAD_TOO_LARGE: 'Corpo da requisição muito grande',
  IDEMPOTENCY_KEY_REUSED: 'Idempotency-Key já usada com outro payload',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente',
  ACCOUNT_BUSY: 'Conta ocupada, tente novamente',
  INTERNAL_ERROR: 'Erro interno',
};

/** Todo code de domínio precisa existir no contrato (erro de compilação se não existir). */
type _DomainCodesAreContractCodes = DomainErrorCode extends ErrorCode ? true : never;
export const _domainCodesCheck: _DomainCodesAreContractCodes = true;

/** Codes que pedem nova tentativa: Retry-After em segundos (specs/README, erros transversais). */
const RETRY_AFTER_SECONDS: Partial<Record<ErrorCode, number>> = {
  REQUEST_IN_PROGRESS: 1,
  ACCOUNT_BUSY: 1,
};

export interface FieldError {
  path: string;
  message: string;
}

/** Erro da borda HTTP (validação, auth, headers): não pertence ao domínio. */
export class HttpProblem extends Error {
  override readonly name = 'HttpProblem';
  constructor(
    readonly code:
      | Exclude<ErrorCode, DomainErrorCode | 'INTERNAL_ERROR'>
      | 'INVALID_DOCUMENT'
      | 'INVALID_CURSOR',
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? code);
  }
}

export function buildProblem(code: ErrorCode, detail?: string, errors?: FieldError[]): Problem {
  return {
    type: `https://mini-banco.dev/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLE_BY_CODE[code],
    status: STATUS_BY_CODE[code],
    ...(detail ? { detail } : {}),
    code,
    correlationId: getCorrelationId() ?? 'unknown',
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}

/** Escreve a resposta direto no node:http (usado pelo filtro do Nest e pelos middlewares). */
export function sendProblem(res: ServerResponse, problem: Problem): void {
  const retryAfter = RETRY_AFTER_SECONDS[problem.code];
  if (retryAfter !== undefined) res.setHeader(HEADERS.retryAfter, String(retryAfter));
  res.statusCode = problem.status;
  res.setHeader('content-type', 'application/problem+json; charset=utf-8');
  res.end(JSON.stringify(problem));
}
