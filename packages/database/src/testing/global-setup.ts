// globalSetup do Vitest para integração/e2e: sobe o Postgres uma vez e entrega a URL
// de administração aos arquivos de teste via provide/inject.
import type { TestProject } from 'vitest/node';
import { startTestPostgres } from './postgres';

import './provided-context';

export default async function setup(project: TestProject) {
  const pg = await startTestPostgres();
  project.provide('pgAdminUrl', pg.adminUrl);
  return async () => {
    await pg.stop();
  };
}
