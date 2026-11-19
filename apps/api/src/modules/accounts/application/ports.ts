import type { Money } from '../../../shared/domain/money';
import type { Account } from '../domain/account';
import type { Cpf } from '../domain/cpf';

export interface NewAccount {
  id: string;
  holderName: string;
  document: Cpf;
  balance: Money;
}

export interface AccountRepository {
  /** Lança DocumentAlreadyRegisteredError se o CPF já existir (ACC-BR-05). */
  insert(account: NewAccount): Promise<Account>;
  findById(id: string): Promise<Account | null>;
  /**
   * `SELECT ... FOR UPDATE` em ordem crescente de id (TRF-BR-05, PERF-08). Devolve só as
   * que existem. Lança AccountBusyError se o lock não vier dentro do lock_timeout.
   */
  lockByIds(ids: readonly string[]): Promise<Account[]>;
  saveBalances(accounts: readonly Account[]): Promise<void>;
}
export const ACCOUNT_REPOSITORY = Symbol('AccountRepository');
