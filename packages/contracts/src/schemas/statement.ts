import { z } from 'zod';
import { STATEMENT_DEFAULT_LIMIT, STATEMENT_MAX_LIMIT } from '../constants';
import { DateTimeSchema, UuidSchema } from './common';

export const LedgerEntryTypeSchema = z.enum(['OPENING', 'DEBIT', 'CREDIT']);
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;

export const StatementEntrySchema = z.strictObject({
  id: UuidSchema,
  type: LedgerEntryTypeSchema,
  amountCents: z.int().min(0),
  balanceAfterCents: z.int().min(0),
  transferId: UuidSchema.nullable(),
  counterpartyAccountId: UuidSchema.nullable(),
  createdAt: DateTimeSchema,
});
export type StatementEntry = z.infer<typeof StatementEntrySchema>;

export const StatementPageSchema = z.strictObject({
  items: z.array(StatementEntrySchema).max(STATEMENT_MAX_LIMIT),
  nextCursor: z.string().nullable(),
});
export type StatementPage = z.infer<typeof StatementPageSchema>;

/**
 * Query string do extrato (STM-BR-05, STM-BR-06). Chega como string; `limit` é
 * convertido só se for um inteiro decimal (evita `z.coerce`, que transformaria "" em 0).
 * O formato interno do cursor é validado na API, ao decodificar.
 */
export const StatementQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d{1,3}$/, 'deve ser um inteiro')
    .transform(Number)
    .pipe(z.int().min(1).max(STATEMENT_MAX_LIMIT))
    .optional()
    .transform((value) => value ?? STATEMENT_DEFAULT_LIMIT),
  cursor: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
export type StatementQuery = z.output<typeof StatementQuerySchema>;
