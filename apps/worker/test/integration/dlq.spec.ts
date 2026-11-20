import {
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { createTestQueues, createTestSqsClient } from '@mini-banco/messaging/testing';
import { describe, expect, inject, it } from 'vitest';
import { peekDlq, redriveDlq } from '../../src/dlq/dlq';

async function depth(sqs: SQSClient, url: string) {
  const { Attributes = {} } = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: url,
      AttributeNames: ['ApproximateNumberOfMessages'],
    }),
  );
  return Number(Attributes.ApproximateNumberOfMessages ?? 0);
}

/** Caminho real até a DLQ: 5 recebimentos sem DeleteMessage (redrive policy). */
async function sendToDlq(sqs: SQSClient, queueUrl: string, body: string) {
  await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
  for (let i = 0; i < 6; i++) {
    const { Messages = [] } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, WaitTimeSeconds: 1 }),
    );
    for (const m of Messages) {
      await sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: m.ReceiptHandle,
          VisibilityTimeout: 0,
        }),
      );
    }
  }
}

describe('operação da DLQ', () => {
  it('peek mostra sem consumir; redrive devolve as mensagens à fila principal', async () => {
    const sqs = createTestSqsClient(inject('sqsEndpoint'));
    try {
      const { queueUrl, dlqUrl } = await createTestQueues(sqs);
      await sendToDlq(sqs, queueUrl, '{"foo":1}');
      expect(await depth(sqs, dlqUrl)).toBe(1);

      const peeked = await peekDlq(sqs, dlqUrl);
      expect(peeked).toEqual([expect.objectContaining({ body: '{"foo":1}' })]);
      expect(await peekDlq(sqs, dlqUrl)).toHaveLength(1); // não consumiu

      const { taskHandle } = await redriveDlq(sqs, dlqUrl);
      expect(taskHandle).toBeTruthy();

      const deadline = Date.now() + 10_000;
      while ((await depth(sqs, queueUrl)) === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(await depth(sqs, queueUrl)).toBe(1);
      expect(await depth(sqs, dlqUrl)).toBe(0);
      const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl }));
      expect(Messages[0]?.Body).toBe('{"foo":1}');
    } finally {
      sqs.destroy();
    }
  });
});
