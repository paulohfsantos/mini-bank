// Vitest único na raiz (ADR-0023), com um projeto por nível de teste:
//   unit         pnpm test               rápido, sem Docker
//   integration  pnpm test:integration   Postgres real (Testcontainers)
//   e2e          pnpm test:e2e           HTTP (Supertest) + Postgres real
// Integração e e2e compartilham um container por execução e um banco por arquivo (PERF-26).
// O typecheck é feito à parte (`pnpm typecheck`).
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const DB_GLOBAL_SETUP = 'packages/database/src/testing/global-setup.ts';

export default defineConfig({
  plugins: [
    swc.vite({
      // Não lê os .swcrc dos pacotes: eles excluem *.spec.ts do build.
      swcrc: false,
      // Decorators legados + metadata: o Nest usa para injeção de dependência
      // (o esbuild do Vite não emite metadata).
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2024',
      },
    }),
  ],
  resolve: {
    // Pacotes do workspace apontam para src/ nesta condição (sem build prévio).
    conditions: ['development'],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/src/**/*.spec.ts'],
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
          globalSetup: [DB_GLOBAL_SETUP],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['{apps,packages}/*/test/e2e/**/*.spec.ts'],
          globalSetup: [DB_GLOBAL_SETUP],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
