// @mini-banco/observability: logger, contexto de correlação, middleware HTTP e
// OpenTelemetry (ADR-0010). O SDK é iniciado por `@mini-banco/observability/register`
// (`node --import`); daqui os apps só usam a API (no-op sem SDK).
export {
  getCorrelationId,
  getTraceId,
  resolveCorrelationId,
  runWithCorrelationId,
} from './correlation';
export { createHttpLogger, type NextFunction } from './http-logger';
export { createLogger, REDACT_PATHS, type Logger, type LoggerOptions } from './logger';
export {
  appMetrics,
  type FraudRuleName,
  METRIC_ATTRIBUTE_KEYS,
  type ProcessingOutcome,
} from './telemetry/metrics';
export { shutdownTelemetry } from './telemetry/global';
export {
  activeSpanIds,
  ATTR_CORRELATION_ID,
  currentTraceparent,
  renameActiveSpan,
  setActiveSpanAttributes,
  withConsumerSpan,
  withoutAutoInstrumentation,
  withProducerSpan,
} from './telemetry/tracing';
