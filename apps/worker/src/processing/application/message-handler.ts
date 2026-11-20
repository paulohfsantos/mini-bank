import { CORRELATION_ID_PATTERN, TransferCompletedEventV1Schema } from '@mini-banco/contracts';
import type { Logger } from '@mini-banco/observability';
import { InvalidPayloadError, NonRetryableError, TransferMismatchError } from '../domain/errors';
import type { ProcessTransferCompletedUseCase } from './process-transfer-completed';

export interface IncomingMessage {
  body: string;
  /** ApproximateReceiveCount do SQS (1 na primeira entrega). */
  receiveCount: number;
}

/** O que o consumidor faz com a mensagem no SQS. */
export type Decision =
  | { action: 'delete' }
  /** Não retentável: visibilidade 0 para esgotar o maxReceiveCount e ir à DLQ (PRC-BR-09). */
  | { action: 'reject' }
  | { action: 'retry'; visibilityTimeoutSeconds: number };

export interface BackoffOptions {
  baseSeconds: number;
  maxSeconds: number;
}

/** PRC-BR-09: 5 s, 10 s, 20 s, ... limitado a `maxSeconds`. */
export function backoffSeconds(receiveCount: number, options: BackoffOptions): number {
  const exponent = Math.max(0, receiveCount - 1);
  return Math.min(options.maxSeconds, options.baseSeconds * 2 ** exponent);
}

export function classify(error: unknown): 'non-retryable' | 'retryable' {
  return error instanceof NonRetryableError ? 'non-retryable' : 'retryable';
}

/**
 * PRC-BR-10: correlationId do message attribute; se ausente ou inválido, o do corpo;
 * senão undefined (o consumidor gera um).
 */
export function messageCorrelationId(
  attribute: string | undefined,
  body: string,
): string | undefined {
  if (attribute && CORRELATION_ID_PATTERN.test(attribute)) return attribute;
  try {
    const parsed = JSON.parse(body) as { correlationId?: unknown };
    const fromBody = parsed.correlationId;
    return typeof fromBody === 'string' && CORRELATION_ID_PATTERN.test(fromBody)
      ? fromBody
      : undefined;
  } catch {
    return undefined;
  }
}

export class TransferCompletedHandler {
  constructor(
    private readonly useCase: ProcessTransferCompletedUseCase,
    private readonly logger: Logger,
    private readonly backoff: BackoffOptions = { baseSeconds: 5, maxSeconds: 300 },
  ) {}

  async handle(message: IncomingMessage): Promise<Decision> {
    const startedAt = performance.now();
    try {
      const event = this.parse(message.body);
      const result = await this.useCase.execute(event);
      if (result.outcome === 'duplicate') {
        this.logger.info({ eventId: event.eventId }, 'duplicate event skipped');
      } else {
        this.logger.info(
          {
            eventId: event.eventId,
            transferId: event.data.transferId,
            status: result.review.status,
            reasons: result.review.reasons,
            // PRC-NFR-01 / PERF-18: base para medir o p95 e ajustar o visibility timeout.
            durationMs: Math.round(performance.now() - startedAt),
          },
          'transfer.completed processed',
        );
      }
      return { action: 'delete' };
    } catch (error) {
      return this.onError(error, message);
    }
  }

  private parse(body: string) {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      throw new InvalidPayloadError([{ path: '', message: 'corpo não é JSON válido' }]);
    }
    const parsed = TransferCompletedEventV1Schema.safeParse(json);
    if (!parsed.success) {
      throw new InvalidPayloadError(
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    return parsed.data;
  }

  private onError(error: unknown, message: IncomingMessage): Decision {
    if (classify(error) === 'non-retryable') {
      if (error instanceof InvalidPayloadError) {
        this.logger.error(
          { kind: error.kind, issues: error.issues, receiveCount: message.receiveCount },
          'invalid message; sending to DLQ',
        );
      } else if (error instanceof TransferMismatchError) {
        // SEC-14: possível evento forjado. Só ids e nomes de campos, sem valores do banco.
        this.logger.error(
          {
            security: true,
            kind: error.kind,
            transferId: error.transferId,
            fields: error.fields,
            receiveCount: message.receiveCount,
          },
          'event does not match stored transfer; sending to DLQ',
        );
      }
      return { action: 'reject' };
    }
    const visibilityTimeoutSeconds = backoffSeconds(message.receiveCount, this.backoff);
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.warn(
      {
        err: { name: err.name, message: err.message, code: (err as { code?: unknown }).code },
        receiveCount: message.receiveCount,
        retryInSeconds: visibilityTimeoutSeconds,
      },
      'transient failure; retrying with backoff',
    );
    return { action: 'retry', visibilityTimeoutSeconds };
  }
}
