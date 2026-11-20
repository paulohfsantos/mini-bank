// ElasticMQ em container para testes de integração: um por execução do Vitest, filas
// novas por arquivo de teste (nomes aleatórios), cada uma com a sua DLQ.
import { randomUUID } from 'node:crypto';
import { CreateQueueCommand, GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { createSqsClient } from '../sqs-client';

// Mesma versão do docker-compose.yml.
const IMAGE = 'softwaremill/elasticmq-native:1.7.1';

// generate-node-address: as URLs das filas usam o Host da requisição. Sem isso apontariam
// para a porta 9324 do container, e o SDK (que usa a QueueUrl como endpoint) erraria a porta.
const CONFIG = `
include classpath("application.conf")
generate-node-address = true
rest-sqs { enabled = true, bind-port = 9324, bind-hostname = "0.0.0.0", sqs-limits = strict }
rest-stats { enabled = false }
aws { region = us-east-1, accountId = 000000000000 }
`;

export interface StartedTestElasticMq {
  endpoint: string;
  stop: () => Promise<void>;
}

export async function startTestElasticMq(): Promise<StartedTestElasticMq> {
  const container: StartedTestContainer = await new GenericContainer(IMAGE)
    .withExposedPorts(9324)
    .withCopyContentToContainer([{ content: CONFIG, target: '/opt/elasticmq.conf' }])
    .withWaitStrategy(Wait.forLogMessage(/ElasticMQ server .* started/))
    .start();
  return {
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9324)}`,
    stop: async () => {
      await container.stop();
    },
  };
}

export function createTestSqsClient(endpoint: string, requestTimeoutMs = 25_000): SQSClient {
  return createSqsClient({
    region: 'us-east-1',
    endpoint,
    requestTimeoutMs,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
}

export interface TestQueues {
  queueUrl: string;
  dlqUrl: string;
}

/** Fila principal + DLQ como na AWS (maxReceiveCount = 5, ADR-0007). */
export async function createTestQueues(
  client: SQSClient,
  options: { visibilityTimeoutSeconds?: number; maxReceiveCount?: number } = {},
): Promise<TestQueues> {
  const name = `test-${randomUUID().slice(0, 8)}`;
  const dlq = await client.send(new CreateQueueCommand({ QueueName: `${name}-dlq` }));
  const dlqUrl = dlq.QueueUrl!;
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
  );
  const main = await client.send(
    new CreateQueueCommand({
      QueueName: name,
      Attributes: {
        VisibilityTimeout: String(options.visibilityTimeoutSeconds ?? 30),
        RedrivePolicy: JSON.stringify({
          deadLetterTargetArn: Attributes?.QueueArn,
          maxReceiveCount: String(options.maxReceiveCount ?? 5),
        }),
      },
    }),
  );
  return { queueUrl: main.QueueUrl!, dlqUrl };
}
