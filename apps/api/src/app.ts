// Montagem da aplicação, compartilhada por main.ts e pelos testes e2e/integração:
// o que roda em produção é exatamente o que os testes exercitam.
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type DynamicModule,
  type INestApplication,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { createPool, dbTlsOptions, type Pool } from '@mini-banco/database';
import { createHttpLogger, type Logger } from '@mini-banco/observability';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import type { AppConfig } from './config';
import { AccountsModule } from './modules/accounts/accounts.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { StatementModule } from './modules/statement/statement.module';
import { TransfersModule } from './modules/transfers/transfers.module';
import { DatabaseModule } from './shared/infrastructure/database.module';
import { HealthController } from './shared/infrastructure/http/health.controller';
import {
  createApiKeyAuth,
  createJsonBodyParser,
  createTransferMetrics,
} from './shared/infrastructure/http/middlewares';
import { NestPinoLogger } from './shared/infrastructure/http/nest-logger';
import { ProblemExceptionFilter } from './shared/infrastructure/http/problem.filter';
import { RouteSpanInterceptor } from './shared/infrastructure/http/route-span.interceptor';
import { APP_CONFIG, LOGGER } from './shared/infrastructure/http/tokens';

/** specs/openapi.yaml: mesma profundidade a partir de src/ e de dist/. */
const OPENAPI_PATH = resolve(import.meta.dirname, '../../../specs/openapi.yaml');

interface AppDeps {
  config: AppConfig;
  logger: Logger;
  pool: Pool;
  ownsPool: boolean;
  /** Último passo do shutdown (main.ts: flush da telemetria, OBS-BR-02). */
  onShutdown?: () => Promise<void>;
}

const ON_SHUTDOWN = Symbol('OnShutdown');

@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(ON_SHUTDOWN) private readonly onShutdown: () => Promise<void>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.onShutdown();
  }

  static forRoot(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(deps.pool, deps.ownsPool),
        AccountsModule,
        TransfersModule,
        StatementModule,
        OutboxModule.forRoot(deps.config.outbox, deps.logger),
      ],
      controllers: [HealthController],
      providers: [
        { provide: LOGGER, useValue: deps.logger },
        { provide: APP_CONFIG, useValue: deps.config },
        { provide: APP_FILTER, useClass: ProblemExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: RouteSpanInterceptor },
        { provide: ON_SHUTDOWN, useValue: deps.onShutdown ?? (() => Promise.resolve()) },
      ],
    };
  }
}

export interface CreateAppOptions {
  config: AppConfig;
  logger: Logger;
  /** Pool externo (testes). Sem ele, a aplicação cria e fecha o próprio. */
  pool?: Pool;
  onShutdown?: () => Promise<void>;
}

export async function createApp({
  config,
  logger,
  pool,
  onShutdown,
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
      // verify-full: valida certificado (CA bundle do RDS) e hostname (SEC-20).
      ssl: dbTlsOptions(config.database.ssl, config.database.sslCaFile),
      applicationName: 'api',
      max: config.database.max,
      onIdleError: (error) =>
        logger.warn({ err: { message: error.message } }, 'idle database connection lost'),
    });

  const app = await NestFactory.create(
    AppModule.forRoot({
      config,
      logger,
      pool: appPool,
      ownsPool,
      ...(onShutdown ? { onShutdown } : {}),
    }),
    {
      bodyParser: false,
      logger: new NestPinoLogger(logger),
      abortOnError: false,
      // Sem CORS: o navegador nunca chama a API direto, só o servidor Next (SEC-19).
      cors: false,
    },
  );

  // Ordem importa (TRF-BR-13): headers de segurança → correlação/log → métricas → auth →
  // corpo → rotas. Métricas antes da auth: um 401 em POST /v1/transfers também conta.
  app.use(helmet());
  app.use(createHttpLogger(logger));
  app.use(createTransferMetrics());
  app.use(createApiKeyAuth(config.apiKeys, { publicDocs: !config.production }));
  app.use(createJsonBodyParser());
  // OBS-BR-13 / SEC-17: sem Swagger em produção (vira rota inexistente).
  if (!config.production) {
    app.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(parse(readFileSync(OPENAPI_PATH, 'utf8')) as object),
    );
  }

  app.enableShutdownHooks();
  await app.init();
  return app;
}
