// Configuração do worker, validada no boot (mesmo padrão da API).
import { z } from 'zod';

const EnvSchema = z
  .object({
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DB_HOST: z.string().min(1),
    DB_PORT: z.coerce.number().int().default(5432),
    DB_NAME: z.string().min(1),
    WORKER_DB_USER: z.string().min(1),
    WORKER_DB_PASSWORD: z.string().min(1),
    DB_SSL: z.enum(['disable', 'verify-full']).default('disable'),
    /** PERF-02: 5 no worker. */
    WORKER_DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    /** PRC-NFR-02: no máximo 5 mensagens em paralelo. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(5),
    /** OBS-BR-11: health HTTP do worker. */
    WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    SQS_QUEUE_URL: z.url(),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    AWS_ENDPOINT_URL: z.url().optional(),
  })
  .refine((e) => e.WORKER_CONCURRENCY <= e.WORKER_DB_POOL_MAX, {
    path: ['WORKER_CONCURRENCY'],
    message: 'precisa ser ≤ WORKER_DB_POOL_MAX (PERF-17)',
  });

export interface WorkerConfig {
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl: boolean;
    max: number;
  };
  sqs: { queueUrl: string; region: string; endpoint?: string };
  concurrency: number;
  healthPort: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`configuração inválida: ${problems}`);
  }
  const e = parsed.data;
  return {
    logLevel: e.LOG_LEVEL,
    database: {
      host: e.DB_HOST,
      port: e.DB_PORT,
      database: e.DB_NAME,
      user: e.WORKER_DB_USER,
      password: e.WORKER_DB_PASSWORD,
      ssl: e.DB_SSL === 'verify-full',
      max: e.WORKER_DB_POOL_MAX,
    },
    sqs: {
      queueUrl: e.SQS_QUEUE_URL,
      region: e.AWS_REGION,
      ...(e.AWS_ENDPOINT_URL ? { endpoint: e.AWS_ENDPOINT_URL } : {}),
    },
    concurrency: e.WORKER_CONCURRENCY,
    healthPort: e.WORKER_HEALTH_PORT,
  };
}
