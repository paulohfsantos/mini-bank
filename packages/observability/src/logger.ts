// Logger pino compartilhado (ADR-0011, PERF-24, SEC-21).
import { pino, type DestinationStream, type Logger, type LevelWithSilent } from 'pino';
import { getCorrelationId, getTraceId } from './correlation';

export type { Logger } from 'pino';

/**
 * Caminhos mascarados. O pino não tem curinga de profundidade arbitrária, então os
 * níveis usuais são listados: campo solto, dentro de um objeto e dentro de dois.
 */
export const REDACT_PATHS = [
  'document',
  '*.document',
  '*.*.document',
  'headers["x-api-key"]',
  'headers.authorization',
  '*.headers["x-api-key"]',
  '*.headers.authorization',
];

export interface LoggerOptions {
  /** Nome do serviço (`api`, `worker`), presente em toda linha. */
  service: string;
  level?: LevelWithSilent;
  /** Destino alternativo (testes). Padrão: stdout assíncrono. */
  destination?: DestinationStream;
}

export function createLogger({ service, level = 'info', destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Toda linha emitida dentro de um contexto ganha o correlationId automaticamente,
      // a menos que a própria chamada já o informe.
      mixin: (mergeObject) => {
        const correlationId = 'correlationId' in mergeObject ? undefined : getCorrelationId();
        const traceId = 'traceId' in mergeObject ? undefined : getTraceId();
        return { ...(correlationId ? { correlationId } : {}), ...(traceId ? { traceId } : {}) };
      },
    },
    // Assíncrono (sync: false): escrever log não bloqueia o event loop. O custo é poder
    // perder as últimas linhas num crash abrupto; no shutdown normal o pino faz flush.
    destination ?? pino.destination({ dest: 1, sync: false }),
  );
}
