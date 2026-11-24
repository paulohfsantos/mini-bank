// Sobe a API (ou só o módulo do Nest) contra um banco novo, já migrado, rodando como o
// papel de menor privilégio `mini_banco_api`: os testes exercitam os GRANTs reais.
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { createTestDatabase, type TestDatabase } from '@mini-banco/database/testing';
import { createLogger } from '@mini-banco/observability';
import pg from 'pg';
import { inject } from 'vitest';
import { AppModule, createApp } from '../../src/app';
import type { AppConfig } from '../../src/config';

export const API_KEY = 'test-api-key-0123456789';
export const OTHER_API_KEY = 'other-api-key-0123456789';

export const testConfig: AppConfig = {
  production: false,
  port: 0,
  logLevel: 'silent',
  apiKeys: [
    { clientId: 'web', key: API_KEY },
    { clientId: 'other', key: OTHER_API_KEY },
  ],
  database: { host: '', port: 0, database: '', user: '', password: '', ssl: 'disable', max: 10 },
  // Relay desligado nos testes da API; os testes do relay o rodam explicitamente.
  outbox: { enabled: false, region: 'us-east-1' },
};

export const silentLogger = createLogger({ service: 'test', level: 'silent' });

export interface TestDb {
  db: TestDatabase;
  /** Conexão com o superusuário, para preparar cenários (locks, EXPLAIN, ANALYZE). */
  owner: pg.Pool;
  close: () => Promise<void>;
}

export async function openTestDb(options: { max?: number } = {}): Promise<TestDb> {
  const db = await createTestDatabase(inject('pgAdminUrl'), {
    role: 'mini_banco_api',
    max: options.max ?? 20,
  });
  const owner = new pg.Pool({ connectionString: db.url, max: 5 });
  // Conexão ociosa encerrada pelo servidor (DROP ... WITH (FORCE), parada do container) vira
  // 'error' no pool; sem listener é erro não tratado e o Vitest reprova a execução inteira.
  owner.on('error', () => undefined);
  return {
    db,
    owner,
    close: async () => {
      await owner.end();
      await db.drop();
    },
  };
}

/** Módulo do Nest (sem HTTP) para testes de integração dos use cases com adapters reais. */
export async function compileModule(
  testDb: TestDb,
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
) {
  const builder = Test.createTestingModule({
    imports: [
      AppModule.forRoot({
        config: testConfig,
        logger: silentLogger,
        pool: testDb.db.pool,
        ownsPool: false,
      }),
    ],
  });
  return customize(builder).compile();
}

/** getHttpServer() do Nest é `any`; aqui ganha o tipo concreto. */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

/** API completa (middlewares + Nest) para e2e. */
export async function startApp(testDb: TestDb): Promise<INestApplication> {
  return createApp({ config: testConfig, logger: silentLogger, pool: testDb.db.pool });
}
