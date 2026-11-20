import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../lib/api-client';
import { submitAccount } from './account';

const account = {
  id: '0193a1b2-7c4d-7e5f-8a6b-0000000000aa',
  holderName: 'Maria Teste',
  documentMasked: '***.982.247-**',
  balanceCents: 150000,
  createdAt: '2026-11-18T14:00:00.000Z',
  updatedAt: '2026-11-18T14:00:00.000Z',
};

// CPF gerado (válido, mas falso).
const CPF = '52998224725';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const valid = {
  holderName: '  Maria Teste ',
  document: '529.982.247-25',
  initialBalance: '1.500,00',
};

describe('submitAccount', () => {
  it('[WEB-AC-01] CPF com pontuação e saldo em reais viram o corpo do contrato', async () => {
    const client = { createAccount: vi.fn().mockResolvedValue(account) };
    expect(await submitAccount(form(valid), client)).toEqual({ ok: true, accountId: account.id });
    expect(client.createAccount).toHaveBeenCalledWith({
      holderName: '  Maria Teste ',
      document: CPF,
      initialBalanceCents: 150000,
    });
  });

  it.each([
    ['CPF com dígito errado', { ...valid, document: '52998224724' }, 'document', 'CPF inválido'],
    ['CPF curto', { ...valid, document: '123' }, 'document', 'O CPF deve ter 11 dígitos'],
    ['nome vazio', { ...valid, holderName: '   ' }, 'holderName', 'Informe o nome do titular'],
    [
      'saldo acima do teto',
      { ...valid, initialBalance: '100.000,01' },
      'initialBalance',
      'O valor máximo é R$ 100.000,00',
    ],
  ])('[WEB-AC-02] %s: erro no campo, sem chamada à API', async (_, fields, field, message) => {
    const client = { createAccount: vi.fn() };
    const result = await submitAccount(form(fields), client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state.fieldErrors[field as 'document']).toBe(message);
    expect(client.createAccount).not.toHaveBeenCalled();
  });

  it('[WEB-AC-02] CPF já cadastrado aparece junto do campo', async () => {
    const client = {
      createAccount: vi.fn().mockRejectedValue(
        new ApiFailure({
          kind: 'problem',
          status: 409,
          problem: {
            type: 'https://mini-banco.dev/problems/document-already-registered',
            title: 'Conflito',
            status: 409,
            code: 'DOCUMENT_ALREADY_REGISTERED',
            correlationId: 'c-1',
          },
        }),
      ),
    };
    const result = await submitAccount(form(valid), client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state.fieldErrors.document).toBe('Já existe uma conta para este CPF.');
      expect(result.state.message).toBeUndefined();
    }
  });

  it('[WEB-AC-07] campo extra é rejeitado sem chamar a API', async () => {
    const client = { createAccount: vi.fn() };
    const result = await submitAccount(form({ ...valid, balanceCents: '1' }), client);
    expect(result.ok).toBe(false);
    expect(client.createAccount).not.toHaveBeenCalled();
  });
});
