'use server';

import { redirect } from 'next/navigation';
import { getApi } from '../../../server/api';
import { submitTransfer, type TransferFormState } from '../../../server/transfer';

// Endpoint POST público: toda a validação acontece em submitTransfer (WEB-BR-02 / SEC-24).
export async function createTransferAction(
  _: TransferFormState,
  formData: FormData,
): Promise<TransferFormState> {
  const result = await submitTransfer(formData, getApi());
  if (!result.ok) return result.state;
  redirect(`/transfers/${result.transferId}`);
}
