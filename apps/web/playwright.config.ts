// E2E do front (WEB-AC-01/02/04/05/06/08): navegador real contra a API real.
// Usa o stack local (`pnpm infra:up` + `pnpm db:migrate`) e portas próprias (API 3101,
// web 3100) para não colidir com o `pnpm dev`. Rodar com `pnpm test:web` na raiz.
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const ROOT_ENV = new URL('../../.env', import.meta.url).pathname;
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV); // não sobrescreve o que já existe

export const API_URL = 'http://127.0.0.1:3101';
const WEB_URL = 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: 'test/e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --enable-source-maps ../api/dist/main.js',
      url: `${API_URL}/health/ready`,
      env: { PORT: '3101', OUTBOX_RELAY_ENABLED: 'false', LOG_LEVEL: 'warn', LOG_PRETTY: 'false' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // `next start`: o teste roda contra o build de produção, o mesmo que é varrido no WEB-AC-08.
      command: 'node node_modules/next/dist/bin/next start --port 3100 --hostname 127.0.0.1',
      url: WEB_URL,
      env: { API_URL, NEXT_TELEMETRY_DISABLED: '1' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
