import { z } from 'zod';
import { MAX_HOLDER_NAME_LENGTH, MAX_INITIAL_BALANCE_CENTS } from '../constants';
import { isValidCpf } from '../cpf';
import { DateTimeSchema, UuidSchema } from './common';

// eslint-disable-next-line no-control-regex -- objetivo é justamente detectar caracteres de controle (ACC-BR-04)
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * ACC-BR-04: o valor recebido tem no máximo 120 caracteres; depois de NFC + trim,
 * tem de 1 a 120 e nenhum caractere de controle. A saída já vem normalizada.
 */
export const HolderNameSchema = z
  .string()
  .max(MAX_HOLDER_NAME_LENGTH)
  .transform((value) => value.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .min(1, 'não pode ser vazio')
      .max(MAX_HOLDER_NAME_LENGTH)
      .refine((value) => !CONTROL_CHARS.test(value), 'não pode conter caracteres de controle'),
  );

/** ACC-BR-01. Qualquer falha neste campo vira `INVALID_DOCUMENT` na API. */
export const DocumentSchema = z
  .string()
  // abort: sem 11 dígitos não faz sentido calcular dígito verificador (um erro por campo).
  .regex(/^\d{11}$/, { error: 'deve ter 11 dígitos, sem pontuação', abort: true })
  .refine(isValidCpf, 'CPF inválido');

/** ACC-BR-02 e ACC-BR-03. */
export const InitialBalanceCentsSchema = z.int().min(0).max(MAX_INITIAL_BALANCE_CENTS);

export const CreateAccountRequestSchema = z.strictObject({
  holderName: HolderNameSchema,
  document: DocumentSchema,
  initialBalanceCents: InitialBalanceCentsSchema,
});
export type CreateAccountRequest = z.input<typeof CreateAccountRequestSchema>;
export type CreateAccountCommand = z.output<typeof CreateAccountRequestSchema>;

export const AccountSchema = z.strictObject({
  id: UuidSchema,
  holderName: z.string(),
  documentMasked: z.string().regex(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/),
  balanceCents: z.int().min(0),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});
export type Account = z.infer<typeof AccountSchema>;
