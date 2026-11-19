import { Module } from '@nestjs/common';
import { Database } from '@mini-banco/database';
import { AccountsModule } from '../accounts/accounts.module';
import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/application/ports';
import { GetStatementUseCase } from './application/get-statement.use-case';
import { STATEMENT_REPOSITORY, type StatementRepository } from './application/ports';
import { PgStatementRepository } from './infrastructure/pg-statement.repository';
import { StatementController } from './infrastructure/statement.controller';

@Module({
  imports: [AccountsModule],
  controllers: [StatementController],
  providers: [
    {
      provide: STATEMENT_REPOSITORY,
      useFactory: (db: Database) => new PgStatementRepository(db),
      inject: [Database],
    },
    {
      provide: GetStatementUseCase,
      useFactory: (accounts: AccountRepository, statement: StatementRepository) =>
        new GetStatementUseCase(accounts, statement),
      inject: [ACCOUNT_REPOSITORY, STATEMENT_REPOSITORY],
    },
  ],
})
export class StatementModule {}
