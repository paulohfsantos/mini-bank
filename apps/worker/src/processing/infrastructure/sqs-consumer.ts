import { setTimeout as sleep } from 'node:timers/promises';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import { MESSAGE_ATTRIBUTES } from '@mini-banco/contracts';
import { parseTraceparent } from '@mini-banco/messaging';
import { type Logger, resolveCorrelationId, runWithCorrelationId } from '@mini-banco/observability';
import { mapWithConcurrency } from '../application/concurrency';
import {
  type Decision,
  messageCorrelationId,
  type TransferCompletedHandler,
} from '../application/message-handler';

export interface ConsumerOptions {
  /** PRC-NFR-02 / PERF-17: ≤ 5 e abaixo do pool do banco. */
  concurrency: number;
  waitTimeSeconds: number;
  maxMessages: number;
}

export const DEFAULT_CONSUMER_OPTIONS: ConsumerOptions = {
  concurrency: 5,
  waitTimeSeconds: 20,
  maxMessages: 10,
};

/**
 * Long polling (WaitTimeSeconds 20) → lote com concorrência limitada → decisão por
 * mensagem. `stop()` cancela o ReceiveMessage pendente e espera o lote em andamento
 * (PRC-NFR-03 / PERF-19). DeleteMessage só depois do commit (PRC-BR-08).
 */
export class SqsConsumer {
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly handler: TransferCompletedHandler,
    private readonly logger: Logger,
    private readonly options: ConsumerOptions = DEFAULT_CONSUMER_OPTIONS,
  ) {}

  start(): void {
    if (this.loop) return;
    this.loop = this.run();
    this.logger.info({ component: 'sqs-consumer', ...this.options }, 'consumer started');
  }

  async stop(): Promise<void> {
    if (!this.loop) return;
    this.abort.abort();
    await this.loop;
    this.loop = undefined;
    this.logger.info({ component: 'sqs-consumer' }, 'consumer stopped');
  }

  private async run(): Promise<void> {
    const { signal } = this.abort;
    while (!signal.aborted) {
      let messages: Message[];
      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            WaitTimeSeconds: this.options.waitTimeSeconds,
            MaxNumberOfMessages: this.options.maxMessages,
            MessageAttributeNames: ['All'],
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          { abortSignal: signal },
        );
        messages = result.Messages ?? [];
      } catch (error) {
        if (signal.aborted) break;
        this.logger.error(
          { component: 'sqs-consumer', err: { message: (error as Error).message } },
          'receive failed',
        );
        await sleep(1_000, undefined, { signal }).catch(() => undefined);
        continue;
      }
      // O lote termina mesmo que o stop chegue no meio: não há sinal passado ao handler.
      await mapWithConcurrency(messages, this.options.concurrency, (m) => this.process(m));
    }
  }

  private async process(message: Message): Promise<void> {
    const body = message.Body ?? '';
    const attributes = message.MessageAttributes ?? {};
    const correlationId = resolveCorrelationId(
      messageCorrelationId(attributes[MESSAGE_ATTRIBUTES.correlationId]?.StringValue, body),
    );
    const trace = parseTraceparent(attributes[MESSAGE_ATTRIBUTES.traceparent]?.StringValue);
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');

    await runWithCorrelationId(
      correlationId,
      async () => {
        const decision = await this.handler.handle({ body, receiveCount });
        await this.apply(message, decision);
      },
      trace ? { traceId: trace.traceId } : {},
    );
  }

  private async apply(message: Message, decision: Decision): Promise<void> {
    try {
      if (decision.action === 'delete') {
        await this.client.send(
          new DeleteMessageCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      } else {
        await this.client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: this.queueUrl,
            ReceiptHandle: message.ReceiptHandle,
            VisibilityTimeout: decision.action === 'reject' ? 0 : decision.visibilityTimeoutSeconds,
          }),
        );
      }
    } catch (error) {
      // A mensagem reaparece quando o visibility timeout vencer; o dedupe cobre o delete perdido.
      this.logger.warn(
        {
          component: 'sqs-consumer',
          action: decision.action,
          err: { message: (error as Error).message },
        },
        'failed to acknowledge message',
      );
    }
  }
}
