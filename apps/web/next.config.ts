import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// O .env do monorepo fica na raiz; o Next só lê o do próprio app. loadEnvFile não
// sobrescreve variáveis já definidas (Playwright, Amplify). `node --env-file` não serve:
// o `next dev` repassa execArgv via NODE_OPTIONS, onde a flag é proibida.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Em dev o bundler escolhe a condição `development` do pacote (src/ em TypeScript).
  transpilePackages: ['@mini-banco/contracts'],
};

export default config;
