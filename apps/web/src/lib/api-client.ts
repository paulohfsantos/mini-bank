// Cliente HTTP da API, usado só no servidor Next (Server Components e Server Actions).
// Recebe a key por parâmetro; quem a lê do ambiente é server/api.ts (WEB-BR-01).
import 'server-only';
import {
  type Account,
  AccountSchema,
  type CreateAccountRequest,
  type CreateTransferRequest,
  HEADERS,
  ProblemSchema,
  type StatementPage,
  StatementPageSchema,
  type Transfer,
  TransferSchema,
} from '@mini-banco/contracts';
import type { z } from 'zod';
import type { Failure } from './error-messages';

const TIMEOUT_MS = 5_000;

export class ApiFailure extends Error {
  constructor(readonly failure: Failure) {
    // A mensagem não carrega corpo nem detalhe: pode acabar num log ou no error.tsx.
    super(`API call failed (${failure.kind})`);
    this.name = 'ApiFailure';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  correlationId: string;
}

interface CallOptions<T> {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** Saldo e extrato: sempre do banco (WEB-BR-07). */
  noStore?: boolean;
  schema: z.ZodType<T>;
}

export function createApiClient({ baseUrl, apiKey, correlationId }: ApiClientOptions) {
  async function call<T>(path: string, options: CallOptions<T>): Promise<T> {
    const headers: Record<string, string> = {
      [HEADERS.apiKey]: apiKey,
      [HEADERS.correlationId]: correlationId,
      accept: 'application/json, application/problem+json',
      ...options.headers,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // Sem cache nas demais leituras também: o default do Next 16 já é não cachear, e o
        // x-correlation-id único por requisição tornaria a chave do cache do fetch única.
        ...(options.noStore ? { cache: 'no-store' as const } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiFailure({ kind: 'network', correlationId });
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const problem = ProblemSchema.safeParse(body);
      throw new ApiFailure(
        problem.success
          ? { kind: 'problem', status: response.status, problem: problem.data }
          : { kind: 'unexpected', status: response.status, correlationId },
      );
    }
    const parsed = options.schema.safeParse(body);
    if (!parsed.success)
      throw new ApiFailure({ kind: 'unexpected', status: response.status, correlationId });
    return parsed.data;
  }

  return {
    correlationId,

    getAccount(id: string): Promise<Account> {
      return call(`/v1/accounts/${encodeURIComponent(id)}`, {
        schema: AccountSchema,
        noStore: true,
      });
    },

    getStatement(id: string, query: { cursor?: string; limit: number }): Promise<StatementPage> {
      const params = new URLSearchParams({ limit: String(query.limit) });
      if (query.cursor !== undefined) params.set('cursor', query.cursor);
      return call(`/v1/accounts/${encodeURIComponent(id)}/statement?${params.toString()}`, {
        schema: StatementPageSchema,
        noStore: true,
      });
    },

    getTransfer(id: string): Promise<Transfer> {
      return call(`/v1/transfers/${encodeURIComponent(id)}`, { schema: TransferSchema });
    },

    createAccount(body: CreateAccountRequest): Promise<Account> {
      return call('/v1/accounts', { method: 'POST', body, schema: AccountSchema });
    },

    createTransfer(body: CreateTransferRequest, idempotencyKey: string): Promise<Transfer> {
      return call('/v1/transfers', {
        method: 'POST',
        body,
        headers: { [HEADERS.idempotencyKey]: idempotencyKey },
        schema: TransferSchema,
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
