import type { Server } from 'node:http';
import { createLogger, shutdownTelemetry } from '@mini-banco/observability';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig(process.env);
const logger = createLogger({ service: 'api', level: config.logLevel });

// O SDK do OpenTelemetry já foi iniciado por `--import @mini-banco/observability/register`
// (OBS-BR-01); aqui só o flush no shutdown, depois de fechar pool e relay.
const app = await createApp({ config, logger, onShutdown: () => shutdownTelemetry() });

// PERF-01: maiores que o idle timeout de 60 s do ALB. Se o Node fechasse antes, o ALB
// reaproveitaria uma conexão já fechada e devolveria 502 intermitente.
const server = app.getHttpServer() as Server;
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

await app.listen(config.port);
logger.info({ port: config.port }, 'api listening');
