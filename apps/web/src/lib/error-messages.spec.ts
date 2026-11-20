import { ERROR_CODES } from '@mini-banco/contracts';
import { describe, expect, it } from 'vitest';
import { describeFailure, ERROR_MESSAGES } from './error-messages';

describe('mensagens de erro', () => {
  it('[WEB-AC-09] todo código do contrato tem mensagem em português', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES[code], code).toMatch(/\S/);
    }
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('[WEB-AC-09] problem conhecido → mensagem do código', () => {
    expect(
      describeFailure({
        kind: 'problem',
        status: 422,
        problem: {
          code: 'INSUFFICIENT_FUNDS',
          status: 422,
          title: 't',
          type: 'x',
          correlationId: 'c-1',
        },
      }),
    ).toEqual({ message: 'Saldo insuficiente na conta de origem.' });
  });

  it.each([
    [
      {
        kind: 'problem',
        status: 500,
        problem: {
          code: 'INTERNAL_ERROR',
          status: 500,
          title: 't',
          type: 'x',
          correlationId: 'c-9',
        },
      },
    ],
    [{ kind: 'unexpected', status: 502, correlationId: 'c-9' }],
    [{ kind: 'network', correlationId: 'c-9' }],
  ] as const)(
    '[WEB-AC-09] 5xx, resposta inesperada ou falha de rede → genérica com correlationId',
    (failure) => {
      const { message, correlationId } = describeFailure(failure);
      expect(message).toBe('Não foi possível concluir agora. Tente de novo em instantes.');
      expect(correlationId).toBe('c-9');
    },
  );
});
