// Vitest único na raiz (ADR-0023), com um projeto por nível de teste:
//   unit         pnpm test               rápido, sem Docker
//   integration  pnpm test:integration   Postgres real (Testcontainers)
//   e2e          pnpm test:e2e           HTTP (Supertest) + Postgres real
// Integração e e2e compartilham um container por execução e um banco por arquivo (PERF-26).
// O typecheck é feito à parte (`pnpm typecheck`).
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const DB_GLOBAL_SETUP = 'packages/database/src/testing/global-setup.ts';
const SQS_GLOBAL_SETUP = 'packages/messaging/src/testing/global-setup.ts';

export default defineConfig({
  plugins: [
    swc.vite({
      // Não lê os .swcrc dos pacotes: eles excluem *.spec.ts do build.
      swcrc: false,
      // Decorators legados + metadata: o Nest usa para injeção de dependência
      // (o esbuild do Vite não emite metadata).
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
          // apps/web: JSX com o runtime automático do React 19.
          react: { runtime: 'automatic' },
        },
        target: 'es2024',
      },
    }),
  ],
  resolve: {
    // Pacotes do workspace apontam para src/ nesta condição (sem build prévio).
    conditions: ['development'],
    alias: {
      // `server-only` lança fora do bundle de servidor do Next; nos testes unitários dos
      // módulos de servidor do apps/web ele vira um módulo vazio. A proteção real é
      // verificada no build (WEB-AC-08).
      'server-only': new URL('./apps/web/test/support/server-only-stub.ts', import.meta.url)
        .pathname,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/src/**/*.spec.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [
            '{apps,packages}/*/src/**/*.int.spec.ts',
            '{apps,packages}/*/test/integration/**/*.spec.ts',
          ],
          globalSetup: [DB_GLOBAL_SETUP, SQS_GLOBAL_SETUP],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        // Medições de desempenho (PERF-18): fora do CI, rodar sob demanda (pnpm bench).
        extends: true,
        test: {
          name: 'bench',
          include: ['{apps,packages}/*/test/bench/**/*.spec.ts'],
          globalSetup: [DB_GLOBAL_SETUP, SQS_GLOBAL_SETUP],
          testTimeout: 300_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['{apps,packages}/*/test/e2e/**/*.spec.ts'],
          // apps/web/test/e2e é Playwright (pnpm test:web), não Vitest.
          exclude: ['**/node_modules/**', 'apps/web/**'],
          globalSetup: [DB_GLOBAL_SETUP, SQS_GLOBAL_SETUP],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
