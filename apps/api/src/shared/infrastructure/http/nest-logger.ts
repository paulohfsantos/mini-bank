import type { LoggerService } from '@nestjs/common';
import type { Logger } from '@mini-banco/observability';

/**
 * Logs internos do Nest no mesmo pino JSON da aplicação. O `log()` do Nest é ruído de boot
 * (módulos iniciados, rotas mapeadas): vai para `debug`. Avisos e erros continuam visíveis.
 */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  error(message: unknown, stack?: string, context?: string) {
    this.logger.error({ context, stack }, String(message));
  }
  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }
  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }
  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }
}
