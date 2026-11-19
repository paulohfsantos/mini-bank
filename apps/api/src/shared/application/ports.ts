// Ports compartilhados entre módulos (ADR-0003). Tokens são Symbols simples: a camada de
// aplicação não importa o Nest; o wiring acontece nos módulos (infrastructure).
import type { NewLedgerEntry } from '../domain/ledger-entry';

/** Executa `work` numa transação; tudo que os repositórios fizerem dentro dela é atômico. */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
export const UNIT_OF_WORK = Symbol('UnitOfWork');

/** Ids gerados na aplicação (UUIDv7, PERF-10). Substituível em testes. */
export interface IdGenerator {
  next(): string;
}
export const ID_GENERATOR = Symbol('IdGenerator');

export interface LedgerRepository {
  append(entries: readonly NewLedgerEntry[]): Promise<void>;
}
export const LEDGER_REPOSITORY = Symbol('LedgerRepository');
