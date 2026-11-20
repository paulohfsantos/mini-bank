// Lógica da Server Action de transferência, separada do 'use server' para ser testável.
import 'server-only';
import {
  CreateTransferRequestSchema,
  IdempotencyKeySchema,
  MAX_TRANSFER_CENTS,
  UuidSchema,
} from '@mini-banco/contracts';
import { type ApiClient, ApiFailure } from '../lib/api-client';
import { describeFailure, ERROR_MESSAGES } from '../lib/error-messages';
import { emptyState, type FormState, MALFORMED_REQUEST, readForm } from '../lib/forms';
import { parseReais } from '../lib/money';

export type TransferField = 'sourceAccountId' | 'destinationAccountId' | 'amount';
export type TransferFormState = FormState<TransferField>;

const FIELDS = ['sourceAccountId', 'destinationAccountId', 'amount', 'idempotencyKey'] as const;

/** Caminho do erro no problem+json → campo do formulário. */
const FIELD_OF_PATH: Record<string, TransferField> = {
  sourceAccountId: 'sourceAccountId',
  destinationAccountId: 'destinationAccountId',
  amountCents: 'amount',
};

export type TransferResult =
  { ok: true; transferId: string } | { ok: false; state: TransferFormState };

export async function submitTransfer(
  formData: FormData,
  client: Pick<ApiClient, 'createTransfer'>,
): Promise<TransferResult> {
  const { values: raw, malformed } = readForm(formData, FIELDS);
  const values = {
    sourceAccountId: raw.sourceAccountId.trim(),
    destinationAccountId: raw.destinationAccountId.trim(),
    amount: raw.amount,
  };
  const fail = (state: Partial<TransferFormState>): TransferResult => ({
    ok: false,
    state: { ...emptyState(values), ...state },
  });

  if (malformed || !IdempotencyKeySchema.safeParse(raw.idempotencyKey).success) {
    return fail({ message: MALFORMED_REQUEST });
  }

  const fieldErrors: TransferFormState['fieldErrors'] = {};
  if (!UuidSchema.safeParse(values.sourceAccountId).success) {
    fieldErrors.sourceAccountId = 'Informe o id da conta de origem';
  }
  if (!UuidSchema.safeParse(values.destinationAccountId).success) {
    fieldErrors.destinationAccountId = 'Informe o id da conta de destino';
  } else if (values.destinationAccountId === values.sourceAccountId) {
    fieldErrors.destinationAccountId = ERROR_MESSAGES.SAME_ACCOUNT;
  }
  const amount = parseReais(values.amount, { min: 1, max: MAX_TRANSFER_CENTS });
  if (!amount.ok) fieldErrors.amount = amount.message;
  if (Object.keys(fieldErrors).length > 0 || !amount.ok) return fail({ fieldErrors });

  // Revalida com o schema do contrato (WEB-BR-02): a mesma regra que a API aplica.
  const body = CreateTransferRequestSchema.safeParse({
    sourceAccountId: values.sourceAccountId,
    destinationAccountId: values.destinationAccountId,
    amountCents: amount.cents,
  });
  if (!body.success) return fail({ message: MALFORMED_REQUEST });

  try {
    // A chave vem do formulário renderizado: reenvio = mesma chave = mesma transferência.
    const transfer = await client.createTransfer(body.data, raw.idempotencyKey);
    return { ok: true, transferId: transfer.id };
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    return fail(failureState(error));
  }
}

function failureState(error: ApiFailure): Partial<TransferFormState> {
  const { failure } = error;
  if (failure.kind === 'problem') {
    const { code, errors } = failure.problem;
    if (code === 'SAME_ACCOUNT')
      return { fieldErrors: { destinationAccountId: ERROR_MESSAGES.SAME_ACCOUNT } };
    if (code === 'VALIDATION_ERROR' && errors?.length) {
      const fieldErrors: TransferFormState['fieldErrors'] = {};
      for (const e of errors) {
        const field = FIELD_OF_PATH[e.path];
        if (field) fieldErrors[field] = 'Valor inválido';
      }
      return { message: ERROR_MESSAGES.VALIDATION_ERROR, fieldErrors };
    }
  }
  return describeFailure(failure);
}
