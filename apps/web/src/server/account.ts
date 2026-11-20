// Lógica da Server Action de abertura de conta, separada do 'use server' para ser testável.
import 'server-only';
import { CreateAccountRequestSchema, MAX_INITIAL_BALANCE_CENTS } from '@mini-banco/contracts';
import { type ApiClient, ApiFailure } from '../lib/api-client';
import { describeFailure, ERROR_MESSAGES } from '../lib/error-messages';
import { emptyState, type FormState, MALFORMED_REQUEST, readForm } from '../lib/forms';
import { parseReais } from '../lib/money';
import { cpfError, holderNameError, normalizeCpf } from '../lib/validation';

export type AccountField = 'holderName' | 'document' | 'initialBalance';
export type AccountFormState = FormState<AccountField>;

const FIELDS = ['holderName', 'document', 'initialBalance'] as const;

const FIELD_OF_PATH: Record<string, AccountField> = {
  holderName: 'holderName',
  document: 'document',
  initialBalanceCents: 'initialBalance',
};

export type AccountResult =
  { ok: true; accountId: string } | { ok: false; state: AccountFormState };

export async function submitAccount(
  formData: FormData,
  client: Pick<ApiClient, 'createAccount'>,
): Promise<AccountResult> {
  const { values, malformed } = readForm(formData, FIELDS);
  const fail = (state: Partial<AccountFormState>): AccountResult => ({
    ok: false,
    state: { ...emptyState(values), ...state },
  });
  if (malformed) return fail({ message: MALFORMED_REQUEST });

  const fieldErrors: AccountFormState['fieldErrors'] = {};
  const nameError = holderNameError(values.holderName);
  if (nameError) fieldErrors.holderName = nameError;
  const documentError = cpfError(values.document);
  if (documentError) fieldErrors.document = documentError;
  const balance = parseReais(values.initialBalance, { min: 0, max: MAX_INITIAL_BALANCE_CENTS });
  if (!balance.ok) fieldErrors.initialBalance = balance.message;
  if (Object.keys(fieldErrors).length > 0 || !balance.ok) return fail({ fieldErrors });

  const body = {
    holderName: values.holderName,
    document: normalizeCpf(values.document),
    initialBalanceCents: balance.cents,
  };
  // Revalida com o schema do contrato (WEB-BR-02).
  if (!CreateAccountRequestSchema.safeParse(body).success)
    return fail({ message: MALFORMED_REQUEST });

  try {
    const account = await client.createAccount(body);
    return { ok: true, accountId: account.id };
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    const { failure } = error;
    if (failure.kind === 'problem') {
      const { code, errors } = failure.problem;
      if (code === 'DOCUMENT_ALREADY_REGISTERED')
        return fail({ fieldErrors: { document: ERROR_MESSAGES.DOCUMENT_ALREADY_REGISTERED } });
      if (code === 'INVALID_DOCUMENT')
        return fail({ fieldErrors: { document: ERROR_MESSAGES.INVALID_DOCUMENT } });
      if (code === 'VALIDATION_ERROR' && errors?.length) {
        const mapped: AccountFormState['fieldErrors'] = {};
        for (const e of errors) {
          const field = FIELD_OF_PATH[e.path];
          if (field) mapped[field] = 'Valor inválido';
        }
        return fail({ message: ERROR_MESSAGES.VALIDATION_ERROR, fieldErrors: mapped });
      }
    }
    return fail(describeFailure(failure));
  }
}
