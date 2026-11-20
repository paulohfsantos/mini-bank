'use server';

import { redirect } from 'next/navigation';
import { getApi } from '../../../server/api';
import { type AccountFormState, submitAccount } from '../../../server/account';

// Endpoint POST público: toda a validação acontece em submitAccount (WEB-BR-02 / SEC-24).
export async function createAccountAction(
  _: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const result = await submitAccount(formData, getApi());
  if (!result.ok) return result.state;
  // Fora de try/catch: redirect() funciona lançando uma exceção do Next.
  redirect(`/accounts/${result.accountId}`);
}
