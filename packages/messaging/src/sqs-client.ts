import { SQSClient } from '@aws-sdk/client-sqs';

export interface SqsClientOptions {
  region: string;
  /**
   * Só no local (ElasticMQ, ADR-0022). Na AWS fica indefinido e o SDK usa o endpoint real,
   * autenticando pela task role (sem access keys).
   */
  endpoint?: string;
  /** Timeout por requisição. O relay usa 3 s (OBX-BR-02); o long polling precisa de > 20 s. */
  requestTimeoutMs: number;
  /** Tentativas do SDK. Padrão 2: uma repetição curta; retries longos ficam com quem chama. */
  maxAttempts?: number;
  /** Só em testes. Fora deles vem da cadeia padrão do SDK (env local, task role na AWS). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export function createSqsClient(options: SqsClientOptions): SQSClient {
  return new SQSClient({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    maxAttempts: options.maxAttempts ?? 2,
    ...(options.credentials ? { credentials: options.credentials } : {}),
    requestHandler: {
      requestTimeout: options.requestTimeoutMs,
      connectionTimeout: Math.min(1_000, options.requestTimeoutMs),
    },
  });
}

/** Erro curto e sem PII para `outbox.last_error` e logs. */
export function describeSqsError(error: unknown, max = 500): string {
  if (error instanceof Error) {
    const code = (error as { name?: string }).name ?? 'Error';
    return `${code}: ${error.message}`.slice(0, max);
  }
  return String(error).slice(0, max);
}
