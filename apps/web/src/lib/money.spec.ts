import { describe, expect, it } from 'vitest';
import { formatCents, parseReais } from './money';

const nbsp = (s: string) => s.replace(/\s/g, ' ');

describe('parseReais', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['0,5', 50],
    ['10', 1000],
    ['0,01', 1],
    ['  150,00 ', 15000],
    ['R$ 1.500,00', 150000],
  ])('[WEB-AC-03] "%s" → %i centavos', (input, cents) => {
    expect(parseReais(input, { max: 100_000_000 })).toEqual({ ok: true, cents });
  });

  it.each(['1,234', '-1', '1e3', 'abc', '1.23,45', '', '   ', '1,', ',5', '1.2345', '0x10'])(
    '[WEB-AC-03] "%s" é rejeitado',
    (input) => {
      expect(parseReais(input, { max: 100_000_000 }).ok).toBe(false);
    },
  );

  it('[WEB-AC-03] acima do teto é rejeitado com mensagem', () => {
    const result = parseReais('12.345.678,90', { max: 100_000_000 });
    expect(result).toEqual({ ok: false, message: 'O valor máximo é R$ 1.000.000,00' });
  });

  it('[WEB-AC-03] mínimo configurável: transferência exige mais que zero', () => {
    expect(parseReais('0,00', { min: 1, max: 100 }).ok).toBe(false);
    expect(parseReais('0,00', { min: 0, max: 100 })).toEqual({ ok: true, cents: 0 });
  });

  it('[WEB-AC-03] não passa por float: 0,29 e 1.005,35 são exatos', () => {
    // 0.29 * 100 = 28.999999999999996 em float
    expect(parseReais('0,29', { max: 1e8 })).toEqual({ ok: true, cents: 29 });
    expect(parseReais('1.005,35', { max: 1e8 })).toEqual({ ok: true, cents: 100535 });
  });
});

describe('formatCents', () => {
  it('[WEB-AC-03] 150000 centavos → R$ 1.500,00', () => {
    expect(nbsp(formatCents(150_000))).toBe('R$ 1.500,00');
    expect(nbsp(formatCents(1))).toBe('R$ 0,01');
    expect(nbsp(formatCents(0))).toBe('R$ 0,00');
  });

  it('[WEB-AC-03] com sinal para lançamentos', () => {
    expect(nbsp(formatCents(1234, { sign: '-' }))).toBe('- R$ 12,34');
    expect(nbsp(formatCents(1234, { sign: '+' }))).toBe('+ R$ 12,34');
  });
});
