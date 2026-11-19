import type { Account as AccountResponse } from '@mini-banco/contracts';
import { AccountNotFoundError } from '../../../shared/domain/errors';
import { toAccountResponse } from './account-mapper';
import type { AccountRepository } from './ports';

/** ACC-AC-05/06. */
export class GetAccountUseCase {
  constructor(private readonly accounts: AccountRepository) {}

  async execute(id: string): Promise<AccountResponse> {
    const account = await this.accounts.findById(id);
    if (!account) throw new AccountNotFoundError();
    return toAccountResponse(account);
  }
}
