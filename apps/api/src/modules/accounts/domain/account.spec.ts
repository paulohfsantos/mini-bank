import { describe, expect, it } from 'vitest';
import { InsufficientFundsError, InvalidDocumentError } from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';
import { Account } from './account';
import { Cpf } from './cpf';

describe('Cpf', () => {
  it('[ACC-AC-04] rejeita CPF inválido com InvalidDocumentError', () => {
    expect(() => Cpf.parse('52998224724')).toThrow(InvalidDocumentError);
    expect(() => Cpf.parse('11111111111')).toThrow(InvalidDocumentError);
  });

  it('[SEC-21] não expõe o CPF completo em toString nem em JSON', () => {
    const cpf = Cpf.parse('52998224725');
    expect(cpf.value).toBe('52998224725');
    expect(String(cpf)).toBe('***.982.247-**');
    expect(JSON.stringify({ cpf })).not.toContain('52998224725');
  });
});

describe('Account', () => {
  const account = (cents: number) =>
    new Account({
      id: 'a',
      holderName: 'Maria',
      document: Cpf.parse('52998224725'),
      balance: Money.fromCents(cents),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  it('debita e credita', () => {
    const a = account(1000);
    a.debit(Money.fromCents(400));
    a.credit(Money.fromCents(50));
    expect(a.balance.cents).toBe(650n);
  });

  it('permite debitar o saldo inteiro', () => {
    const a = account(1000);
    a.debit(Money.fromCents(1000));
    expect(a.balance.cents).toBe(0n);
  });

  it('[TRF-BR-03] débito acima do saldo lança InsufficientFundsError e não altera o saldo', () => {
    const a = account(1000);
    expect(() => a.debit(Money.fromCents(1001))).toThrow(InsufficientFundsError);
    expect(a.balance.cents).toBe(1000n);
  });
});
