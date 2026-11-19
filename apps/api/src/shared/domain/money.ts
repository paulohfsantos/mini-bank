// Dinheiro em centavos inteiros (ADR-0009): bigint internamente, nunca float.

/** Violação de invariante (bug), não erro de negócio: vira 500. */
export class InvalidMoneyError extends Error {
  override readonly name = 'InvalidMoneyError';
}

export class Money {
  private constructor(readonly cents: bigint) {}

  static readonly ZERO = new Money(0n);

  /** Aceita bigint ou number inteiro seguro; rejeita negativos, decimais e NaN. */
  static fromCents(cents: bigint | number): Money {
    let value: bigint;
    if (typeof cents === 'number') {
      if (!Number.isSafeInteger(cents)) {
        throw new InvalidMoneyError(`valor em centavos não é inteiro seguro: ${cents}`);
      }
      value = BigInt(cents);
    } else {
      value = cents;
    }
    if (value < 0n) throw new InvalidMoneyError('dinheiro não pode ser negativo');
    return new Money(value);
  }

  plus(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  minus(other: Money): Money {
    if (other.cents > this.cents) throw new InvalidMoneyError('resultado negativo');
    return new Money(this.cents - other.cents);
  }

  isLessThan(other: Money): boolean {
    return this.cents < other.cents;
  }

  equals(other: Money): boolean {
    return this.cents === other.cents;
  }

  /**
   * PERF-09: conversão para a borda JSON. Falha alto se não couber num number exato,
   * em vez de arredondar silenciosamente.
   */
  toSafeNumber(): number {
    const value = Number(this.cents);
    if (!Number.isSafeInteger(value)) {
      throw new InvalidMoneyError(`valor fora do intervalo seguro do JSON: ${this.cents}`);
    }
    return value;
  }

  toString(): string {
    return this.cents.toString();
  }
}
