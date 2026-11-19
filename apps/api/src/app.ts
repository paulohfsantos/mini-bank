// Montagem da aplicação, compartilhada por main.ts e pelos testes e2e/integração:
// o que roda em produção é exatamente o que os testes exercitam.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type DynamicModule, type INestApplication, Module } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { createPool, type Pool } from '@mini-banco/database';
import { createHttpLogger, type Logger } from '@mini-banco/observability';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import type { AppConfig } from './config';
import { AccountsModule } from './modules/accounts/accounts.module';
import { StatementModule } from './modules/statement/statement.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { DatabaseModule } from './shared/infrastructure/database.module';
import { HealthController } from './shared/infrastructure/http/health.controller';
import { createApiKeyAuth, createJsonBodyParser } from './shared/infrastructure/http/middlewares';
import { NestPinoLogger } from './shared/infrastructure/http/nest-logger';
import { ProblemExceptionFilter } from './shared/infrastructure/http/problem.filter';
import { APP_CONFIG, LOGGER } from './shared/infrastructure/http/tokens';

/** specs/openapi.yaml: mesma profundidade a partir de src/ e de dist/. */
const OPENAPI_PATH = resolve(import.meta.dirname, '../../../specs/openapi.yaml');

interface AppDeps {
  config: AppConfig;
  logger: Logger;
  pool: Pool;
  ownsPool: boolean;
}

@Module({})
export class AppModule {
  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(deps.pool, deps.ownsPool),
        AccountsModule,
        TransfersModule,
        StatementModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: LOGGER, useValue: deps.logger },
        { provide: APP_CONFIG, useValue: deps.config },
        { provide: APP_FILTER, useClass: ProblemExceptionFilter },
      ],
    };
  }
}

export interface CreateAppOptions {
  config: AppConfig;
  logger: Logger;
  /** Pool externo (testes). Sem ele, a aplicação cria e fecha o próprio. */
  pool?: Pool;
}

export async function createApp({
  config,
  logger,
  pool,
}: CreateAppOptions): Promise<INestApplication> {
  const ownsPool = pool === undefined;
  const appPool =
    pool ??
    createPool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      // verify-full: valida certificado e hostname (CA do RDS entra na fase 6).
      ssl: config.database.ssl ? { rejectUnauthorized: true } : false,
      applicationName: 'api',
      max: config.database.max,
    });

  const app = await NestFactory.create(
    AppModule.forRoot({ config, logger, pool: appPool, ownsPool }),
    {
      bodyParser: false,
      logger: new NestPinoLogger(logger),
      abortOnError: false,
      // Sem CORS: o navegador nunca chama a API direto, só o servidor Next (SEC-19).
      cors: false,
    },
  );

  // Ordem importa (TRF-BR-13): headers de segurança → correlação/log → auth → corpo → rotas.
  app.use(helmet());
  app.use(createHttpLogger(logger));
  app.use(createApiKeyAuth(config.apiKeys));
  app.use(createJsonBodyParser());
  app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(parse(readFileSync(OPENAPI_PATH, 'utf8')) as object),
  );

  app.enableShutdownHooks();
  await app.init();
  return app;
}
