// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountFormState } from '../server/account';
import { AccountForm } from './account-form';

afterEach(cleanup);

function setup() {
  const action = vi.fn<(state: AccountFormState, data: FormData) => Promise<AccountFormState>>();
  render(<AccountForm action={action} />);
  return { action, user: userEvent.setup() };
}

describe('AccountForm', () => {
  it('[WEB-AC-02] CPF com dígito errado: "CPF inválido" ao sair do campo', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('CPF'), '529.982.247-24');
    await user.tab();

    const input = screen.getByLabelText('CPF');
    expect(screen.getByText('CPF inválido')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('document-error');
  });

  it('[WEB-AC-02] enviar com CPF inválido não chama a action', async () => {
    const { action, user } = setup();
    await user.type(screen.getByLabelText('Nome do titular'), 'Maria Teste');
    await user.type(screen.getByLabelText('CPF'), '11111111111');
    await user.click(screen.getByRole('button', { name: 'Abrir conta' }));

    expect(await screen.findByText('CPF inválido')).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it('[WEB-AC-02] dados válidos chamam a action; erro devolvido aparece junto do campo', async () => {
    const { action, user } = setup();
    action.mockResolvedValue({
      fieldErrors: { document: 'Já existe uma conta para este CPF.' },
      values: { holderName: 'Maria Teste', document: '52998224725', initialBalance: '10,00' },
    });
    await user.type(screen.getByLabelText('Nome do titular'), 'Maria Teste');
    await user.type(screen.getByLabelText('CPF'), '52998224725');
    await user.clear(screen.getByLabelText('Saldo inicial (R$)'));
    await user.type(screen.getByLabelText('Saldo inicial (R$)'), '10,00');
    await user.click(screen.getByRole('button', { name: 'Abrir conta' }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const data = action.mock.calls[0]![1];
    expect(Object.fromEntries(data.entries())).toEqual({
      holderName: 'Maria Teste',
      document: '52998224725',
      initialBalance: '10,00',
    });
    expect(await screen.findByText('Já existe uma conta para este CPF.')).toBeTruthy();
  });
});
