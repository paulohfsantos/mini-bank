// Configuração lida do ambiente uma vez, validada com zod: falha no boot, não na primeira requisição.
import { z } from 'zod';

const ApiKeysSchema = z
  .string()
  .min(1)
  .transform((raw) => raw.split(',').map((pair) => pair.trim()))
  .pipe(
    z
      .array(
        z
          .string()
          .regex(
            /^[a-z0-9-]{1,32}:[A-Za-z0-9_\-.]{16,256}$/,
            'formato esperado: clientId:chave (chave ≥ 16 caracteres)',
          )
          .transform((pair) => {
            const index = pair.indexOf(':');
            return { clientId: pair.slice(0, index), key: pair.slice(index + 1) };
          }),
      )
      .min(1),
  );

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().min(1),
  API_DB_USER: z.string().min(1),
  API_DB_PASSWORD: z.string().min(1),
  /** `verify-full` na AWS (CA do RDS no container, fase 6); `disable` local. */
  DB_SSL: z.enum(['disable', 'verify-full']).default('disable'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** `clientId:chave` separados por vírgula. O clientId escopa as chaves de idempotência (TRF-BR-08). */
  API_KEYS: ApiKeysSchema,
});

export interface ApiKeyEntry {
  clientId: string;
  key: string;
}

export interface AppConfig {
  port: number;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  apiKeys: ApiKeyEntry[];
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
    max: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Só os nomes das variáveis e a regra violada; nunca os valores (podem ser segredos).
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`configuração inválida: ${problems}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    apiKeys: e.API_KEYS,
    database: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      database: e.DB_NAME,
      user: e.API_DB_USER,
      password: e.API_DB_PASSWORD,
      ssl: e.DB_SSL === 'verify-full',
      max: e.DB_POOL_MAX,
    },
  };
}
