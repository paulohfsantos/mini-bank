'use client';

import { MAX_INITIAL_BALANCE_CENTS } from '@mini-banco/contracts';
import { type FocusEvent, type FormEvent, useActionState, useState } from 'react';
import { emptyState } from '../lib/forms';
import { parseReais } from '../lib/money';
import { cpfError, holderNameError } from '../lib/validation';
import type { AccountField, AccountFormState } from '../server/account';
import { Field } from './field';
import { FormAlert } from './form-alert';
import { SubmitButton } from './submit-button';
import ui from './ui.module.css';

type Errors = Partial<Record<AccountField, string>>;

const CHECKS: Record<AccountField, (value: string) => string | undefined> = {
  holderName: holderNameError,
  document: cpfError,
  initialBalance: (value) => {
    const result = parseReais(value, { min: 0, max: MAX_INITIAL_BALANCE_CENTS });
    return result.ok ? undefined : result.message;
  },
};

interface Props {
  action: (state: AccountFormState, formData: FormData) => Promise<AccountFormState>;
}

export function AccountForm({ action }: Props) {
  const [state, formAction] = useActionState(action, emptyState<AccountField>());
  // Erros do cliente têm precedência; somem quando o campo é corrigido.
  const [clientErrors, setClientErrors] = useState<Errors>({});

  const check = (field: AccountField, value: string) =>
    setClientErrors((prev) => ({ ...prev, [field]: CHECKS[field](value) }));

  const onBlur = (event: FocusEvent<HTMLInputElement>) =>
    check(event.target.name as AccountField, event.target.value);

  // Validação instantânea (WEB-AC-02): com erro, a action nem é chamada. Sem JavaScript
  // este handler não existe e a action valida sozinha (WEB-NFR-01).
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const data = new FormData(event.currentTarget);
    const errors: Errors = {};
    for (const field of Object.keys(CHECKS) as AccountField[]) {
      const value = data.get(field);
      errors[field] = CHECKS[field](typeof value === 'string' ? value : '');
    }
    setClientErrors(errors);
    if (Object.values(errors).some(Boolean)) event.preventDefault();
  };

  const error = (field: AccountField) => clientErrors[field] ?? state.fieldErrors[field];

  return (
    <form action={formAction} onSubmit={onSubmit} className={ui.form} noValidate>
      <FormAlert message={state.message} correlationId={state.correlationId} />
      <Field
        name="holderName"
        label="Nome do titular"
        defaultValue={state.values.holderName}
        maxLength={120}
        autoComplete="off"
        onBlur={onBlur}
        error={error('holderName')}
      />
      <Field
        name="document"
        label="CPF"
        hint="Use um CPF gerado para testes."
        defaultValue={state.values.document}
        inputMode="numeric"
        maxLength={14}
        autoComplete="off"
        onBlur={onBlur}
        error={error('document')}
      />
      <Field
        name="initialBalance"
        label="Saldo inicial (R$)"
        hint="Até R$ 100.000,00. Ex.: 1.500,00"
        defaultValue={state.values.initialBalance ?? '0,00'}
        inputMode="decimal"
        autoComplete="off"
        onBlur={onBlur}
        error={error('initialBalance')}
      />
      <SubmitButton pendingText="Abrindo…">Abrir conta</SubmitButton>
    </form>
  );
}
