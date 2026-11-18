import { z } from 'zod';
import { CorrelationIdSchema, DateTimeSchema, UuidSchema } from '../schemas/common';
import { AmountCentsSchema } from '../schemas/transfers';

// Espelha specs/events/transfer.completed.v1.schema.json.
// z.object (não strictObject): consumidores ignoram campos desconhecidos (evolução aditiva).

export const TRANSFER_COMPLETED = 'transfer.completed';

/** Message attributes SQS (todos String). */
export const MESSAGE_ATTRIBUTES = {
  eventType: 'eventType',
  correlationId: 'correlationId',
  traceparent: 'traceparent',
} as const;

export const TransferCompletedEventV1Schema = z.object({
  eventId: UuidSchema,
  eventType: z.literal(TRANSFER_COMPLETED),
  eventVersion: z.literal(1),
  occurredAt: DateTimeSchema,
  correlationId: CorrelationIdSchema,
  data: z.object({
    transferId: UuidSchema,
    sourceAccountId: UuidSchema,
    destinationAccountId: UuidSchema,
    amountCents: AmountCentsSchema,
    completedAt: DateTimeSchema,
  }),
});
export type TransferCompletedEventV1 = z.infer<typeof TransferCompletedEventV1Schema>;
