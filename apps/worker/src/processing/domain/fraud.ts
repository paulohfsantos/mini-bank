// Antifraude simples (PRC-BR-04..06). Regras puras: recebem o contexto já calculado.

export const RULE_VERSION = '2026-11-v1';

export type FraudReason = 'HIGH_AMOUNT' | 'HIGH_VELOCITY';
export type ReviewStatus = 'FLAGGED' | 'CLEARED';

export interface FraudContext {
  amountCents: number;
  /** Transferências da origem na janela de velocidade, incluindo a atual. */
  sourceTransfersInWindow: number;
}

export interface FraudRule {
  readonly reason: FraudReason;
  matches(context: FraudContext): boolean;
}

/** PRC-BR-04: R$ 10.000,00 ou mais. */
export class HighAmountRule implements FraudRule {
  readonly reason = 'HIGH_AMOUNT';
  constructor(private readonly thresholdCents = 1_000_000) {}
  matches(context: FraudContext): boolean {
    return context.amountCents >= this.thresholdCents;
  }
}

export const VELOCITY_WINDOW_MS = 10 * 60 * 1000;

/** PRC-BR-05: 5 ou mais transferências da origem na janela de 10 min. */
export class HighVelocityRule implements FraudRule {
  readonly reason = 'HIGH_VELOCITY';
  constructor(private readonly threshold = 5) {}
  matches(context: FraudContext): boolean {
    return context.sourceTransfersInWindow >= this.threshold;
  }
}

/**
 * Janela [completedAt − 10 min, completedAt], fechada nas duas pontas. Relativa ao
 * evento, nunca a now(): reprocessar com atraso dá o mesmo resultado (PERF-20).
 */
export function velocityWindow(completedAt: Date): { from: Date; to: Date } {
  return { from: new Date(completedAt.getTime() - VELOCITY_WINDOW_MS), to: completedAt };
}

export const DEFAULT_RULES: readonly FraudRule[] = [new HighAmountRule(), new HighVelocityRule()];

/** PRC-BR-06: FLAGGED com os motivos se alguma regra disparar; senão CLEARED. */
export function analyze(
  rules: readonly FraudRule[],
  context: FraudContext,
): { status: ReviewStatus; reasons: FraudReason[] } {
  const reasons = rules.filter((r) => r.matches(context)).map((r) => r.reason);
  return { status: reasons.length > 0 ? 'FLAGGED' : 'CLEARED', reasons };
}
