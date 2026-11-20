// Ponto de entrada do OpenTelemetry: `node --import @mini-banco/observability/register dist/main.js`.
// Roda antes do main.ts (OBS-BR-01): registra o loader ESM só para os módulos
// instrumentados e inicia o SDK. Configuração pelas variáveis padrão do OTel:
//   OTEL_SDK_DISABLED=true          desliga tudo
//   OTEL_SERVICE_NAME               api | worker
//   OTEL_EXPORTER_OTLP_ENDPOINT     padrão http://localhost:4318
//   METRICS_PORT                    porta do /metrics Prometheus (OBS-BR-09); ausente = sem servidor
import { register, supportsSyncHooks } from 'import-in-the-middle/register-hooks.mjs';

const env = process.env;

if (env.OTEL_SDK_DISABLED !== 'true') {
  const { INSTRUMENTED_MODULES, startTelemetry } = await import('./sdk');
  // Loader síncrono (module.registerHooks): sem thread separada. Node 26+ (ver .nvmrc).
  if (!supportsSyncHooks()) {
    throw new Error('Node sem module.registerHooks síncrono: atualize para a versão do .nvmrc');
  }
  register({ include: INSTRUMENTED_MODULES });

  const metricsPort = env.METRICS_PORT ? Number(env.METRICS_PORT) : undefined;
  if (metricsPort !== undefined && !Number.isInteger(metricsPort)) {
    throw new Error('METRICS_PORT inválida');
  }
  startTelemetry({
    serviceName: env.OTEL_SERVICE_NAME ?? 'unknown',
    ...(metricsPort !== undefined ? { metricsPort } : {}),
  });
}
