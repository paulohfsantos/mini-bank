import { describe, expect, it } from 'vitest';
import { parseTraceparent } from './traceparent';

describe('parseTraceparent', () => {
  it('[PRC-BR-10] extrai o traceId de um traceparent W3C válido', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
  });

  it.each([
    undefined,
    '',
    'lixo',
    '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
    '00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01',
  ])('ignora traceparent ausente ou inválido: %s', (value) => {
    expect(parseTraceparent(value)).toBeUndefined();
  });
});
