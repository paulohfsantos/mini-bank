// Sanidade do ambiente de teste: a fila criada aceita mensagens e a DLQ recebe após
// maxReceiveCount recebimentos (o comportamento do SQS que o worker usa em PRC-BR-09).
import {
  ChangeMessageVisibilityCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { describe, expect, inject, it } from 'vitest';
import { createTestQueues, createTestSqsClient } from './index';

describe('ElasticMQ de teste', () => {
  it('mensagem recebida 5 vezes sem DeleteMessage vai para a DLQ', async () => {
    const client = createTestSqsClient(inject('sqsEndpoint'));
    const { queueUrl, dlqUrl } = await createTestQueues(client);
    await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: '{"foo":1}' }));

    for (let i = 0; i < 5; i++) {
      const { Messages } = await client.send(
        new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 1 }),
      );
      expect(Messages, `recebimento ${i + 1}`).toHaveLength(1);
      await client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: Messages![0]!.ReceiptHandle,
          VisibilityTimeout: 0,
        }),
      );
    }

    const main = await client.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 1 }),
    );
    expect(main.Messages ?? []).toHaveLength(0);
    const dlq = await client.send(
      new ReceiveMessageCommand({ QueueUrl: dlqUrl, WaitTimeSeconds: 1 }),
    );
    expect(dlq.Messages?.[0]?.Body).toBe('{"foo":1}');
    client.destroy();
  });
});
