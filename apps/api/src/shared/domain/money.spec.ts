import { describe, expect, it } from 'vitest';
import { InvalidMoneyError, Money } from './money';

describe('Money', () => {
  it('aceita bigint e number inteiro seguro', () => {
    expect(Money.fromCents(150).cents).toBe(150n);
    expect(Money.fromCents(9007199254740993n).cents).toBe(9007199254740993n);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('rejeita %s', (value) => {
    expect(() => Money.fromCents(value)).toThrow(InvalidMoneyError);
  });

  it('rejeita bigint negativo', () => {
    expect(() => Money.fromCents(-1n)).toThrow(InvalidMoneyError);
  });

  it('soma e subtrai sem perda de precisão', () => {
    const a = Money.fromCents(9007199254740993n);
    expect(a.plus(Money.fromCents(2)).cents).toBe(9007199254740995n);
    expect(a.minus(Money.fromCents(3)).cents).toBe(9007199254740990n);
  });

  it('subtração que ficaria negativa é violação de invariante', () => {
    expect(() => Money.fromCents(1).minus(Money.fromCents(2))).toThrow(InvalidMoneyError);
  });

  it('compara', () => {
    expect(Money.fromCents(1).isLessThan(Money.fromCents(2))).toBe(true);
    expect(Money.fromCents(2).equals(Money.fromCents(2))).toBe(true);
  });

  it('[PERF-09] converte para number só quando é inteiro seguro', () => {
    expect(Money.fromCents(100_000_000).toSafeNumber()).toBe(100_000_000);
    expect(() => Money.fromCents(2n ** 53n).toSafeNumber()).toThrow(InvalidMoneyError);
  });
});
