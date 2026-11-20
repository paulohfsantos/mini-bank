// pnpm dlq:peek | pnpm dlq:redrive (lê SQS_DLQ_URL e AWS_* do ambiente).
// Acompanhar o redrive: console do SQS ou `aws sqs list-message-move-tasks` (o ElasticMQ
// não responde a ListMessageMoveTasks).
import { createSqsClient } from '@mini-banco/messaging';
import { peekDlq, redriveDlq } from './dlq';

const [command] = process.argv.slice(2);
const dlqUrl = process.env.SQS_DLQ_URL;
if (!dlqUrl) throw new Error('defina SQS_DLQ_URL');

const client = createSqsClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(process.env.AWS_ENDPOINT_URL ? { endpoint: process.env.AWS_ENDPOINT_URL } : {}),
  requestTimeoutMs: 10_000,
});

const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

try {
  if (command === 'peek') print(await peekDlq(client, dlqUrl));
  else if (command === 'redrive') print(await redriveDlq(client, dlqUrl));
  else throw new Error('uso: dlq <peek|redrive>');
} finally {
  client.destroy();
}
