// Operação da DLQ (ADR-0007): inspecionar e devolver mensagens para a fila principal.
import {
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  type SQSClient,
  StartMessageMoveTaskCommand,
} from '@aws-sdk/client-sqs';

export interface PeekedMessage {
  messageId: string;
  receiveCount: number;
  sentAt: string | undefined;
  attributes: Record<string, string | undefined>;
  /** Truncado: eventos só têm ids e valores (SEC-21), mas a DLQ aceita qualquer coisa. */
  body: string;
}

/**
 * Lê até `max` mensagens sem consumi-las: VisibilityTimeout 0 as deixa visíveis de novo
 * na hora. Não há DeleteMessage aqui.
 */
export async function peekDlq(
  client: SQSClient,
  dlqUrl: string,
  max = 10,
): Promise<PeekedMessage[]> {
  const { Messages = [] } = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: dlqUrl,
      MaxNumberOfMessages: Math.min(10, max),
      VisibilityTimeout: 0,
      WaitTimeSeconds: 1,
      MessageAttributeNames: ['All'],
      MessageSystemAttributeNames: ['ApproximateReceiveCount', 'SentTimestamp'],
    }),
  );
  return Messages.map((m) => ({
    messageId: m.MessageId ?? '',
    receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? 0),
    sentAt: m.Attributes?.SentTimestamp
      ? new Date(Number(m.Attributes.SentTimestamp)).toISOString()
      : undefined,
    attributes: Object.fromEntries(
      Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [k, v.StringValue]),
    ),
    body: (m.Body ?? '').slice(0, 500),
  }));
}

async function queueArn(client: SQSClient, url: string): Promise<string> {
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }),
  );
  if (!Attributes?.QueueArn) throw new Error(`sem QueueArn para ${url}`);
  return Attributes.QueueArn;
}

/**
 * Redrive via StartMessageMoveTask: o próprio SQS move as mensagens da DLQ de volta para
 * a fila de origem (sem DestinationArn = fila de onde vieram). Use depois de corrigir a causa.
 */
export async function redriveDlq(
  client: SQSClient,
  dlqUrl: string,
): Promise<{ taskHandle: string | undefined; sourceArn: string }> {
  const sourceArn = await queueArn(client, dlqUrl);
  const { TaskHandle } = await client.send(
    new StartMessageMoveTaskCommand({ SourceArn: sourceArn }),
  );
  return { taskHandle: TaskHandle, sourceArn };
}
