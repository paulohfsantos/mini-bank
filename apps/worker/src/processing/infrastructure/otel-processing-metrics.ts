import { appMetrics } from '@mini-banco/observability';
import type { ProcessingMetrics } from '../application/ports';

/** Adapter do port de métricas para o OpenTelemetry (no-op sem SDK). */
export const otelProcessingMetrics: ProcessingMetrics = {
  processed: (outcome, durationMs) => appMetrics.workerProcessed(outcome, durationMs),
  flagged: (reasons) => appMetrics.fraudFlagged(reasons),
};
