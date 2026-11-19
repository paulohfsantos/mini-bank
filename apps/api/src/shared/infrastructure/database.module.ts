import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Database, type Pool } from '@mini-banco/database';
import { ID_GENERATOR, LEDGER_REPOSITORY, UNIT_OF_WORK } from '../application/ports';
import { PgLedgerRepository, PgUnitOfWork, UuidV7Generator } from './persistence';

export const POOL = Symbol('Pool');
const POOL_OWNED = Symbol('PoolOwned');

/** Pool, Database (unidade de trabalho via AsyncLocalStorage) e adapters compartilhados. */
@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(POOL_OWNED) private readonly owned: boolean,
  ) {}

  /** `owned`: o pool foi criado pela aplicação e deve ser fechado no shutdown. */
  static forRoot(pool: Pool, owned: boolean): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: POOL, useValue: pool },
        { provide: POOL_OWNED, useValue: owned },
        { provide: Database, useFactory: () => new Database(pool) },
        {
          provide: UNIT_OF_WORK,
          useFactory: (db: Database) => new PgUnitOfWork(db),
          inject: [Database],
        },
        { provide: ID_GENERATOR, useFactory: () => new UuidV7Generator() },
        {
          provide: LEDGER_REPOSITORY,
          useFactory: (db: Database) => new PgLedgerRepository(db),
          inject: [Database],
        },
      ],
      exports: [POOL, Database, UNIT_OF_WORK, ID_GENERATOR, LEDGER_REPOSITORY],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.owned) await this.pool.end();
  }
}
