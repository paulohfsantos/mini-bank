import type { Account as AccountResponse, CreateAccountCommand } from '@mini-banco/contracts';
import type { IdGenerator, LedgerRepository, UnitOfWork } from '../../../shared/application/ports';
import { Money } from '../../../shared/domain/money';
import { Cpf } from '../domain/cpf';
import { toAccountResponse } from './account-mapper';
import type { AccountRepository } from './ports';

/** ACC-AC-01/02. Conta e lançamento OPENING no mesmo commit (ACC-BR-07). */
export class CreateAccountUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly accounts: AccountRepository,
    private readonly ledger: LedgerRepository,
  ) {}

  /** Recebe o comando já validado e normalizado pelo schema (nome em NFC + trim). */
  async execute(command: CreateAccountCommand): Promise<AccountResponse> {
    const document = Cpf.parse(command.document);
    const balance = Money.fromCents(command.initialBalanceCents);

    return this.uow.run(async () => {
      const account = await this.accounts.insert({
        id: this.ids.next(),
        holderName: command.holderName,
        document,
        balance,
      });
      await this.ledger.append([
        {
          id: this.ids.next(),
          accountId: account.id,
          transferId: null,
          type: 'OPENING',
          amount: balance,
          balanceAfter: balance,
        },
      ]);
      return toAccountResponse(account);
    });
  }
}
