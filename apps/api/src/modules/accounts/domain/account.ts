import { InsufficientFundsError } from '../../../shared/domain/errors';
import type { Money } from '../../../shared/domain/money';
import type { Cpf } from './cpf';

export interface AccountProps {
  id: string;
  holderName: string;
  document: Cpf;
  balance: Money;
  createdAt: Date;
  updatedAt: Date;
}

export class Account {
  private _balance: Money;

  constructor(private readonly props: AccountProps) {
    this._balance = props.balance;
  }

  get id(): string {
    return this.props.id;
  }
  get holderName(): string {
    return this.props.holderName;
  }
  get document(): Cpf {
    return this.props.document;
  }
  get balance(): Money {
    return this._balance;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** TRF-BR-03: nunca deixa o saldo negativo. */
  debit(amount: Money): void {
    if (this._balance.isLessThan(amount)) throw new InsufficientFundsError();
    this._balance = this._balance.minus(amount);
  }

  credit(amount: Money): void {
    this._balance = this._balance.plus(amount);
  }
}
