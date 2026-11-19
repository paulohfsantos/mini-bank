import { z } from 'zod';
import { CORRELATION_ID_PATTERN, IDEMPOTENCY_KEY_PATTERN } from '../constants';

export const UuidSchema = z.uuid();

/** Datas sempre em ISO 8601 UTC com `Z` (o servidor nunca emite offset). */
export const DateTimeSchema = z.iso.datetime();

export const CorrelationIdSchema = z.string().regex(CORRELATION_ID_PATTERN);

export const IdempotencyKeySchema = z.string().regex(IDEMPOTENCY_KEY_PATTERN);

/** Espelha components.schemas.ErrorCode do openapi.yaml. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_DOCUMENT',
  'INVALID_CURSOR',
  'SAME_ACCOUNT',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'UNAUTHORIZED',
  'ACCOUNT_NOT_FOUND',
  'TRANSFER_NOT_FOUND',
  'DOCUMENT_ALREADY_REGISTERED',
  'REQUEST_IN_PROGRESS',
  'PAYLOAD_TOO_LARGE',
  'IDEMPOTENCY_KEY_REUSED',
  'INSUFFICIENT_FUNDS',
  'ACCOUNT_BUSY',
  'ROUTE_NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** RFC 9457 Problem Details com as extensões do mini-banco. */
export const ProblemSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: ErrorCodeSchema,
  correlationId: CorrelationIdSchema,
  errors: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export const HealthSchema = z.strictObject({
  status: z.enum(['ok', 'error']),
});
export type Health = z.infer<typeof HealthSchema>;
