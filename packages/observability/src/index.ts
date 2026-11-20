// @mini-banco/observability: logger, contexto de correlação e middleware HTTP.
// OpenTelemetry chega na fase 5 (ADR-0010).
export {
  getCorrelationId,
  getTraceId,
  resolveCorrelationId,
  runWithCorrelationId,
} from './correlation';
export { createHttpLogger, type NextFunction } from './http-logger';
export { createLogger, REDACT_PATHS, type Logger, type LoggerOptions } from './logger';
