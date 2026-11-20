'use client';

import { MAX_TRANSFER_CENTS } from '@mini-banco/contracts';
import { type FocusEvent, type FormEvent, useActionState, useState } from 'react';
import { ERROR_MESSAGES } from '../lib/error-messages';
import { emptyState } from '../lib/forms';
import { parseReais } from '../lib/money';
import { accountIdError } from '../lib/validation';
import type { TransferField, TransferFormState } from '../server/transfer';
import { Field } from './field';
import { FormAlert } from './form-alert';
import { SubmitButton } from './submit-button';
import ui from './ui.module.css';

type Errors = Partial<Record<TransferField, string>>;

function validate(field: TransferField, value: string, data: FormData): string | undefined {
  switch (field) {
    case 'sourceAccountId':
      return accountIdError(value, 'origem');
    case 'destinationAccountId': {
      const source = data.get('sourceAccountId');
      return (
        accountIdError(value, 'destino') ??
        (typeof source === 'string' && source.trim() === value.trim()
          ? ERROR_MESSAGES.SAME_ACCOUNT
          : undefined)
      );
    }
    case 'amount': {
      const result = parseReais(value, { min: 1, max: MAX_TRANSFER_CENTS });
      return result.ok ? undefined : result.message;
    }
  }
}

const FIELDS: TransferField[] = ['sourceAccountId', 'destinationAccountId', 'amount'];

interface Props {
  action: (state: TransferFormState, formData: FormData) => Promise<TransferFormState>;
  /** Gerada no servidor, uma vez por renderização do formulário (WEB-BR-03). */
  idempotencyKey: string;
  defaultSource?: string;
}

export function TransferForm({ action, idempotencyKey, defaultSource }: Props) {
  const [state, formAction] = useActionState(
    action,
    emptyState<TransferField>({ sourceAccountId: defaultSource }),
  );
  const [clientErrors, setClientErrors] = useState<Errors>({});

  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    const field = event.target.name as TransferField;
    const data = new FormData(event.target.form ?? undefined);
    setClientErrors((prev) => ({ ...prev, [field]: validate(field, event.target.value, data) }));
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const errors: Errors = {};
    for (const field of FIELDS) {
      const value = data.get(field);
      errors[field] = validate(field, typeof value === 'string' ? value : '', data);
    }
    setClientErrors(errors);
    if (Object.values(errors).some(Boolean)) event.preventDefault();
  };

  const error = (field: TransferField) => clientErrors[field] ?? state.fieldErrors[field];

  return (
    <form action={formAction} onSubmit={onSubmit} className={ui.form} noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <FormAlert message={state.message} correlationId={state.correlationId} />
      <Field
        name="sourceAccountId"
        label="Conta de origem (id)"
        defaultValue={state.values.sourceAccountId}
        autoComplete="off"
        onBlur={onBlur}
        error={error('sourceAccountId')}
      />
      <Field
        name="destinationAccountId"
        label="Conta de destino (id)"
        defaultValue={state.values.destinationAccountId}
        autoComplete="off"
        onBlur={onBlur}
        error={error('destinationAccountId')}
      />
      <Field
        name="amount"
        label="Valor (R$)"
        hint="Ex.: 150,00"
        defaultValue={state.values.amount}
        inputMode="decimal"
        autoComplete="off"
        onBlur={onBlur}
        error={error('amount')}
      />
      <SubmitButton pendingText="Transferindo…">Transferir</SubmitButton>
    </form>
  );
}
