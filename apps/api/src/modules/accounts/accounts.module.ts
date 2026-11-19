import { Module } from '@nestjs/common';
import { Database } from '@mini-banco/database';
import {
  type IdGenerator,
  ID_GENERATOR,
  LEDGER_REPOSITORY,
  type LedgerRepository,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '../../shared/application/ports';
import { CreateAccountUseCase } from './application/create-account.use-case';
import { GetAccountUseCase } from './application/get-account.use-case';
import { ACCOUNT_REPOSITORY, type AccountRepository } from './application/ports';
import { AccountsController } from './infrastructure/accounts.controller';
import { PgAccountRepository } from './infrastructure/pg-account.repository';

// Wiring por factories: use cases continuam sem decorators do Nest (ADR-0003).
@Module({
  controllers: [AccountsController],
  providers: [
    {
      provide: ACCOUNT_REPOSITORY,
      useFactory: (db: Database) => new PgAccountRepository(db),
      inject: [Database],
    },
    {
      provide: CreateAccountUseCase,
      useFactory: (
        uow: UnitOfWork,
        ids: IdGenerator,
        accounts: AccountRepository,
        ledger: LedgerRepository,
      ) => new CreateAccountUseCase(uow, ids, accounts, ledger),
      inject: [UNIT_OF_WORK, ID_GENERATOR, ACCOUNT_REPOSITORY, LEDGER_REPOSITORY],
    },
    {
      provide: GetAccountUseCase,
      useFactory: (accounts: AccountRepository) => new GetAccountUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
  ],
  exports: [ACCOUNT_REPOSITORY],
})
export class AccountsModule {}
