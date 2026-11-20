import { describe, expect, it } from 'vitest';
import { analyze, DEFAULT_RULES, HighAmountRule, HighVelocityRule, velocityWindow } from './fraud';

const ctx = (amountCents: number, sourceTransfersInWindow = 1) => ({
  amountCents,
  sourceTransfersInWindow,
});

describe('HighAmountRule', () => {
  it('[PRC-AC-02] 1.000.000 centavos dispara; 999.999 não', () => {
    const rule = new HighAmountRule();
    expect(rule.matches(ctx(1_000_000))).toBe(true);
    expect(rule.matches(ctx(999_999))).toBe(false);
  });
});

describe('HighVelocityRule', () => {
  it('[PRC-AC-03] a 5ª transferência na janela dispara; a 4ª não', () => {
    const rule = new HighVelocityRule();
    expect(rule.matches(ctx(100, 5))).toBe(true);
    expect(rule.matches(ctx(100, 4))).toBe(false);
  });

  it('[PRC-AC-03] janela é [completedAt − 10 min, completedAt], independente de now() (PERF-20)', () => {
    const completedAt = new Date('2026-11-18T14:00:00.000Z');
    const { from, to } = velocityWindow(completedAt);
    expect(from.toISOString()).toBe('2026-11-18T13:50:00.000Z');
    expect(to).toEqual(completedAt);

    const tenMinutesAndOneSecondBefore = new Date('2026-11-18T13:49:59.000Z');
    expect(tenMinutesAndOneSecondBefore < from).toBe(true);
  });
});

describe('analyze', () => {
  it('[PRC-AC-01] abaixo dos limites → CLEARED sem motivos', () => {
    expect(analyze(DEFAULT_RULES, ctx(15_000))).toEqual({ status: 'CLEARED', reasons: [] });
  });

  it('[PRC-AC-02] valor alto → FLAGGED com HIGH_AMOUNT', () => {
    expect(analyze(DEFAULT_RULES, ctx(1_000_000))).toEqual({
      status: 'FLAGGED',
      reasons: ['HIGH_AMOUNT'],
    });
  });

  it('[PRC-BR-06] as duas regras juntas → os dois motivos', () => {
    expect(analyze(DEFAULT_RULES, ctx(2_000_000, 6)).reasons).toEqual([
      'HIGH_AMOUNT',
      'HIGH_VELOCITY',
    ]);
  });
});
