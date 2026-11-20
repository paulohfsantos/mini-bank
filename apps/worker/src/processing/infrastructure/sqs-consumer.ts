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
import {
  ATTR_CORRELATION_ID,
  type Logger,
  resolveCorrelationId,
  runWithCorrelationId,
  withConsumerSpan,
  withoutAutoInstrumentation,
} from '@mini-banco/observability';
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
  private lastReceiveStartedAt = 0;
  private lastReceiveFailed = false;

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

  /**
   * OBS-BR-11: loop rodando, último ReceiveMessage sem falha e iniciado há menos de
   * `maxSilenceMs` (long polling de 20 s + lote de até ~28 s cabem em 60 s).
   */
  healthy(now = Date.now(), maxSilenceMs = 60_000): boolean {
    return (
      this.loop !== undefined &&
      !this.lastReceiveFailed &&
      now - this.lastReceiveStartedAt < maxSilenceMs
    );
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
      this.lastReceiveStartedAt = Date.now();
      try {
        // Sem span automático: seria um trace vazio a cada 20 s de long polling. O trace
        // de cada mensagem começa no span de processamento (OBS-BR-04).
        const result = await withoutAutoInstrumentation(() =>
          this.client.send(
            new ReceiveMessageCommand({
              QueueUrl: this.queueUrl,
              WaitTimeSeconds: this.options.waitTimeSeconds,
              MaxNumberOfMessages: this.options.maxMessages,
              MessageAttributeNames: ['All'],
              MessageSystemAttributeNames: ['ApproximateReceiveCount'],
            }),
            { abortSignal: signal },
          ),
        );
        messages = result.Messages ?? [];
        this.lastReceiveFailed = false;
      } catch (error) {
        if (signal.aborted) break;
        this.lastReceiveFailed = true;
        this.logger.error(
          { component: 'sqs-consumer', err: { message: (error as Error).message } },
          'receive failed',
        );
        await sleep(1_000, undefined, { signal }).catch(() => undefined);
        continue;
      }
      // O lote termina mesmo que o stop chegue no meio: não há sinal passado ao handler.
      const receivedAt = performance.now();
      await mapWithConcurrency(messages, this.options.concurrency, (m) =>
        this.process(m, receivedAt),
      );
    }
  }

  private async process(message: Message, receivedAt: number): Promise<void> {
    const body = message.Body ?? '';
    const attributes = message.MessageAttributes ?? {};
    const correlationId = resolveCorrelationId(
      messageCorrelationId(attributes[MESSAGE_ATTRIBUTES.correlationId]?.StringValue, body),
    );
    const traceparent = attributes[MESSAGE_ATTRIBUTES.traceparent]?.StringValue;
    const trace = parseTraceparent(traceparent);
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');

    await runWithCorrelationId(
      correlationId,
      () =>
        // OBS-BR-04: filho do span da requisição que criou a transferência. O handler
        // nunca lança (erros viram Decision), então o span só falha em bug.
        withConsumerSpan(
          'transfer.completed process',
          {
            ...(traceparent ? { traceparent } : {}),
            attributes: {
              [ATTR_CORRELATION_ID]: correlationId,
              'messaging.system': 'aws_sqs',
              'messaging.operation.type': 'process',
              ...(message.MessageId ? { 'messaging.message.id': message.MessageId } : {}),
            },
          },
          async (span) => {
            const decision = await this.handler.handle({ body, receiveCount });
            span.setAttribute('app.decision', decision.action);
            await this.apply(message, decision);
            // PERF-18: tempo em que a mensagem ficou invisível antes do ack (inclui a espera
            // na fila do lote). É este número que precisa caber no visibility timeout.
            this.logger.debug(
              {
                component: 'sqs-consumer',
                action: decision.action,
                inFlightMs: Math.round(performance.now() - receivedAt),
              },
              'message acknowledged',
            );
          },
        ),
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
