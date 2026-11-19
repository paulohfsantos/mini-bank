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
import { AccountsModule } from '../accounts/accounts.module';
import { ACCOUNT_REPOSITORY, type AccountRepository } from '../accounts/application/ports';
import { GetTransferUseCase } from './application/get-transfer.use-case';
import {
  IDEMPOTENCY_STORE,
  type IdempotencyStore,
  OUTBOX_WRITER,
  type OutboxWriter,
  TRANSFER_REPOSITORY,
  type TransferRepository,
} from './application/ports';
import { TransferFundsUseCase } from './application/transfer-funds.use-case';
import { PgIdempotencyStore } from './infrastructure/pg-idempotency.store';
import { PgOutboxWriter } from './infrastructure/pg-outbox.writer';
import { PgTransferRepository } from './infrastructure/pg-transfer.repository';
import { TransfersController } from './infrastructure/transfers.controller';

@Module({
  imports: [AccountsModule],
  controllers: [TransfersController],
  providers: [
    {
      provide: TRANSFER_REPOSITORY,
      useFactory: (db: Database) => new PgTransferRepository(db),
      inject: [Database],
    },
    {
      provide: IDEMPOTENCY_STORE,
      useFactory: (db: Database) => new PgIdempotencyStore(db),
      inject: [Database],
    },
    {
      provide: OUTBOX_WRITER,
      useFactory: (db: Database) => new PgOutboxWriter(db),
      inject: [Database],
    },
    {
      provide: TransferFundsUseCase,
      useFactory: (
        uow: UnitOfWork,
        ids: IdGenerator,
        accounts: AccountRepository,
        ledger: LedgerRepository,
        transfers: TransferRepository,
        idempotency: IdempotencyStore,
        outbox: OutboxWriter,
      ) => new TransferFundsUseCase(uow, ids, accounts, ledger, transfers, idempotency, outbox),
      inject: [
        UNIT_OF_WORK,
        ID_GENERATOR,
        ACCOUNT_REPOSITORY,
        LEDGER_REPOSITORY,
        TRANSFER_REPOSITORY,
        IDEMPOTENCY_STORE,
        OUTBOX_WRITER,
      ],
    },
    {
      provide: GetTransferUseCase,
      useFactory: (transfers: TransferRepository) => new GetTransferUseCase(transfers),
      inject: [TRANSFER_REPOSITORY],
    },
  ],
})
export class TransfersModule {}
