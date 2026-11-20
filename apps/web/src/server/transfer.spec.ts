import { describe, expect, it, vi } from 'vitest';
import { ApiFailure } from '../lib/api-client';
import { submitTransfer } from './transfer';

const A = '0193a1b2-7c4d-7e5f-8a6b-0000000000aa';
const B = '0193a1b2-7c4d-7e5f-8a6b-0000000000bb';
const KEY = '0193a1b2-7c4d-7e5f-8a6b-00000000feed';

const transfer = {
  id: '0193a1b2-7c4d-7e5f-8a6b-000000000001',
  sourceAccountId: A,
  destinationAccountId: B,
  amountCents: 15000,
  status: 'COMPLETED' as const,
  createdAt: '2026-11-18T14:00:00.000Z',
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.append(k, v);
  return data;
}

const valid = {
  sourceAccountId: A,
  destinationAccountId: B,
  amount: '150,00',
  idempotencyKey: KEY,
};

function fakeClient() {
  return { createTransfer: vi.fn().mockResolvedValue(transfer) };
}

describe('submitTransfer', () => {
  it('[WEB-AC-06] dois envios do mesmo formulário usam a mesma Idempotency-Key', async () => {
    const client = fakeClient();
    const first = await submitTransfer(form(valid), client);
    const second = await submitTransfer(form(valid), client);

    expect(first).toEqual({ ok: true, transferId: transfer.id });
    expect(second).toEqual({ ok: true, transferId: transfer.id });
    expect(client.createTransfer).toHaveBeenCalledTimes(2);
    const keys = client.createTransfer.mock.calls.map((call) => call[1] as string);
    expect(keys).toEqual([KEY, KEY]);
    expect(client.createTransfer.mock.calls[0]![0]).toEqual({
      sourceAccountId: A,
      destinationAccountId: B,
      amountCents: 15000,
    });
  });

  it.each([
    ['valor negativo', { ...valid, amount: '-10' }, 'amount'],
    ['valor com float disfarçado', { ...valid, amount: '1e3' }, 'amount'],
    ['acima do teto', { ...valid, amount: '1.000.000,01' }, 'amount'],
    ['origem que não é UUID', { ...valid, sourceAccountId: "1' OR '1'='1" }, 'sourceAccountId'],
    ['mesma conta', { ...valid, destinationAccountId: A }, 'destinationAccountId'],
  ])('[WEB-AC-07] %s: erro de validação e nenhuma chamada à API', async (_, fields, field) => {
    const client = fakeClient();
    const result = await submitTransfer(form(fields), client);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.state.fieldErrors).toHaveProperty(field);
    expect(client.createTransfer).not.toHaveBeenCalled();
  });

  it('[WEB-AC-07] campo extra, campo repetido ou chave inválida: rejeita sem chamar a API', async () => {
    for (const data of [
      form({ ...valid, amountCents: '999999' }),
      (() => {
        const f = form(valid);
        f.append('amount', '1,00');
        return f;
      })(),
      form({ ...valid, idempotencyKey: 'tem espaço' }),
      form({ sourceAccountId: A, destinationAccountId: B, amount: '1,00' }),
    ]) {
      const client = fakeClient();
      const result = await submitTransfer(data, client);
      expect(result.ok).toBe(false);
      expect(client.createTransfer).not.toHaveBeenCalled();
    }
  });

  it('[WEB-AC-07] campos internos do React ($ACTION_*) são ignorados', async () => {
    const client = fakeClient();
    const result = await submitTransfer(form({ ...valid, $ACTION_ID_abc: '' }), client);
    expect(result).toEqual({ ok: true, transferId: transfer.id });
  });

  it('[WEB-AC-05] saldo insuficiente vira mensagem e preserva o que foi digitado', async () => {
    const client = {
      createTransfer: vi.fn().mockRejectedValue(
        new ApiFailure({
          kind: 'problem',
          status: 422,
          problem: {
            type: 'https://mini-banco.dev/problems/insufficient-funds',
            title: 'Saldo insuficiente',
            status: 422,
            code: 'INSUFFICIENT_FUNDS',
            correlationId: 'c-1',
          },
        }),
      ),
    };
    const result = await submitTransfer(form(valid), client);
    expect(result).toEqual({
      ok: false,
      state: {
        message: 'Saldo insuficiente na conta de origem.',
        fieldErrors: {},
        values: { sourceAccountId: A, destinationAccountId: B, amount: '150,00' },
      },
    });
  });

  it('[WEB-AC-09] falha de rede: mensagem genérica com correlationId', async () => {
    const client = {
      createTransfer: vi
        .fn()
        .mockRejectedValue(new ApiFailure({ kind: 'network', correlationId: 'c-77' })),
    };
    const result = await submitTransfer(form(valid), client);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.state.message).toBe(
        'Não foi possível concluir agora. Tente de novo em instantes.',
      );
      expect(result.state.correlationId).toBe('c-77');
    }
  });

  it('erro que não é da API sobe (cai no error.tsx)', async () => {
    const client = { createTransfer: vi.fn().mockRejectedValue(new Error('bug')) };
    await expect(submitTransfer(form(valid), client)).rejects.toThrow('bug');
  });
});
