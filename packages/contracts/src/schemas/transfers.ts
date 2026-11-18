import { z } from 'zod';
import { MAX_TRANSFER_CENTS } from '../constants';
import { DateTimeSchema, UuidSchema } from './common';

/** TRF-BR-01. */
export const AmountCentsSchema = z.int().min(1).max(MAX_TRANSFER_CENTS);

/**
 * Origem ≠ destino (TRF-BR-02) não fica no schema de propósito: é regra de negócio,
 * validada no domínio depois do schema, com código próprio (`SAME_ACCOUNT`, TRF-BR-13).
 */
export const CreateTransferRequestSchema = z.strictObject({
  sourceAccountId: UuidSchema,
  destinationAccountId: UuidSchema,
  amountCents: AmountCentsSchema,
});
export type CreateTransferRequest = z.infer<typeof CreateTransferRequestSchema>;

export const TransferStatusSchema = z.enum(['COMPLETED']);
export type TransferStatus = z.infer<typeof TransferStatusSchema>;

export const TransferSchema = z.strictObject({
  id: UuidSchema,
  sourceAccountId: UuidSchema,
  destinationAccountId: UuidSchema,
  amountCents: AmountCentsSchema,
  status: TransferStatusSchema,
  createdAt: DateTimeSchema,
});
export type Transfer = z.infer<typeof TransferSchema>;
