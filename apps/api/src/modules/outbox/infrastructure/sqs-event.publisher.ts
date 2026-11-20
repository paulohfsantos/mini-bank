import { type SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { MESSAGE_ATTRIBUTES } from '@mini-banco/contracts';
import { describeSqsError } from '@mini-banco/messaging';
import {
  appMetrics,
  withoutAutoInstrumentation,
  withProducerSpan,
} from '@mini-banco/observability';
import type { EventPublisher, PendingEvent, PublishFailure } from '../application/ports';

/** OBX-BR-02: SendMessageBatch (até 10) com teto de 3 s por chamada. */
export class SqsEventPublisher implements EventPublisher {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
    private readonly timeoutMs = 3_000,
  ) {}

  async publish(
    events: readonly PendingEvent[],
  ): Promise<{ published: string[]; failed: PublishFailure[] }> {
    // Id do lote: posição (o SQS limita o formato); mapeado de volta para o id do outbox.
    const byEntryId = new Map(events.map((e, i) => [`e${i}`, e.id]));
    return withProducerSpan(
      'outbox publish',
      {
        linkedTraceparents: events.map((e) => e.traceparent),
        attributes: {
          'messaging.system': 'aws_sqs',
          'messaging.operation.type': 'send',
          'messaging.batch.message_count': events.length,
        },
      },
      async (span) => {
        const outcome = await this.send(events, byEntryId);
        if (outcome.failed.length > 0)
          span.setAttribute('app.outbox.failed', outcome.failed.length);
        const now = Date.now();
        const published = new Set(outcome.published);
        for (const event of events) {
          if (published.has(event.id)) appMetrics.outboxPublished(now - event.createdAt.getTime());
        }
        return outcome;
      },
    );
  }

  private async send(
    events: readonly PendingEvent[],
    byEntryId: Map<string, string>,
  ): Promise<{ published: string[]; failed: PublishFailure[] }> {
    try {
      const result = await withoutAutoInstrumentation(() =>
        this.client.send(
          new SendMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: events.map((event, i) => ({
              Id: `e${i}`,
              MessageBody: JSON.stringify(event.payload),
              MessageAttributes: {
                [MESSAGE_ATTRIBUTES.eventType]: {
                  DataType: 'String',
                  StringValue: event.eventType,
                },
                [MESSAGE_ATTRIBUTES.correlationId]: {
                  DataType: 'String',
                  StringValue: event.correlationId,
                },
                ...(event.traceparent
                  ? {
                      [MESSAGE_ATTRIBUTES.traceparent]: {
                        DataType: 'String',
                        StringValue: event.traceparent,
                      },
                    }
                  : {}),
              },
            })),
          }),
          { abortSignal: AbortSignal.timeout(this.timeoutMs) },
        ),
      );
      const published = (result.Successful ?? []).flatMap((s) => {
        const id = s.Id ? byEntryId.get(s.Id) : undefined;
        return id ? [id] : [];
      });
      const failed = (result.Failed ?? []).flatMap((f) => {
        const id = f.Id ? byEntryId.get(f.Id) : undefined;
        return id ? [{ id, error: `${f.Code ?? 'Failed'}: ${f.Message ?? ''}`.slice(0, 500) }] : [];
      });
      return { published, failed };
    } catch (error) {
      const message = describeSqsError(error);
      return { published: [], failed: events.map((e) => ({ id: e.id, error: message })) };
    }
  }
}
