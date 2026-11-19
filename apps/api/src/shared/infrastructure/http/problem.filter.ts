import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Logger } from '@mini-banco/observability';
import { DomainError } from '../../domain/errors';
import { buildProblem, HttpProblem, sendProblem } from './problem';
import { LOGGER } from './tokens';

/**
 * Filtro global: todo erro vira problem+json. Desconhecido → 500 genérico com
 * correlationId, sem mensagem do Postgres nem stack na resposta (SEC-13).
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    sendProblem(res, this.toProblem(exception));
  }

  private toProblem(exception: unknown) {
    if (exception instanceof DomainError) return buildProblem(exception.code, exception.message);
    if (exception instanceof HttpProblem) {
      return buildProblem(exception.code, exception.detail, exception.errors);
    }
    if (exception instanceof HttpException) {
      // Exceções do próprio Nest: rota inexistente é a única esperada.
      const status = exception.getStatus();
      if (status === 404) return buildProblem('ROUTE_NOT_FOUND');
      if (status === 413) return buildProblem('PAYLOAD_TOO_LARGE');
      if (status < 500) return buildProblem('VALIDATION_ERROR');
    }

    // Log sem o objeto de erro inteiro: erros do pg trazem `detail` com valores da linha
    // (ex.: o CPF). Só nome, code SQLSTATE, mensagem e stack (SEC-21).
    const err = exception instanceof Error ? exception : new Error(String(exception));
    const code = (exception as { code?: unknown } | null)?.code;
    this.logger.error(
      {
        err: {
          name: err.name,
          message: err.message,
          code: typeof code === 'string' ? code : undefined,
          stack: err.stack,
        },
      },
      'unhandled error',
    );
    return buildProblem('INTERNAL_ERROR');
  }
}
