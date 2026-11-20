// Único lugar que lê a API key (WEB-BR-01 / SEC-25). `server-only` faz o build falhar se
// um Client Component importar este módulo, direta ou indiretamente.
import 'server-only';
import { cache } from 'react';
import { z } from 'zod';
import { createApiClient } from '../lib/api-client';

const EnvSchema = z.object({
  API_URL: z.url().default('http://localhost:3001'),
  // Sem NEXT_PUBLIC_: o Next só embute no bundle do cliente variáveis com esse prefixo.
  API_KEY: z.string().min(16),
});

/**
 * Um cliente por requisição (React `cache`): todas as chamadas de uma renderização ou
 * action compartilham o mesmo x-correlation-id (WEB-BR-06). O ambiente é lido aqui, na
 * requisição, e não no import: o build não precisa da key.
 */
export const getApi = cache(() => {
  const env = EnvSchema.parse(process.env);
  return createApiClient({
    baseUrl: env.API_URL,
    apiKey: env.API_KEY,
    correlationId: crypto.randomUUID(),
  });
});
