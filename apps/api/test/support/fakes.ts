// Implementações em memória dos ports, para testes unitários dos use cases.
// A unidade de trabalho tira um snapshot do estado e o restaura em caso de erro,
// imitando o rollback do banco.
import type { Transfer as TransferResponse, TransferCompletedEventV1 } from '@mini-banco/contracts';
import { Account } from '../../src/modules/accounts/domain/account';
import type { AccountRepository, NewAccount } from '../../src/modules/accounts/application/ports';
import type {
  StatementEntry,
  StatementPosition,
  StatementRepository,
} from '../../src/modules/statement/application/ports';
import type {
  IdempotencyAcquireResult,
  IdempotencyStore,
  NewTransfer,
  OutboxWriter,
  TransferRepository,
} from '../../src/modules/transfers/application/ports';
import type { Transfer } from '../../src/modules/transfers/domain/transfer';
import type { IdGenerator, LedgerRepository, UnitOfWork } from '../../src/shared/application/ports';
import { DocumentAlreadyRegisteredError } from '../../src/shared/domain/errors';
import type { NewLedgerEntry } from '../../src/shared/domain/ledger-entry';
import { Money } from '../../src/shared/domain/money';

interface StoredAccount {
  props: NewAccount;
  balanceCents: bigint;
  createdAt: Date;
}

interface StoredKey {
  requestHash: string;
  status?: number;
  body?: TransferResponse;
}

export class InMemoryState {
  accounts = new Map<string, StoredAccount>();
  transfers = new Map<string, Transfer>();
  ledger: NewLedgerEntry[] = [];
  outbox: TransferCompletedEventV1[] = [];
  keys = new Map<string, StoredKey>();
  clock = new Date('2026-11-18T12:00:00.000Z');

  snapshot(): () => void {
    const copy = {
      accounts: new Map([...this.accounts].map(([k, v]) => [k, { ...v }])),
      transfers: new Map(this.transfers),
      ledger: [...this.ledger],
      outbox: [...this.outbox],
      keys: new Map([...this.keys].map(([k, v]) => [k, { ...v }])),
    };
    return () => Object.assign(this, copy);
  }
}

export class FakeUnitOfWork implements UnitOfWork {
  constructor(private readonly state: InMemoryState) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    const restore = this.state.snapshot();
    try {
      return await work();
    } catch (error) {
      restore();
      throw error;
    }
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `0193a1b2-7c4d-7e5f-8a6b-${this.n.toString().padStart(12, '0')}`;
  }
}

export class FakeAccounts implements AccountRepository {
  constructor(private readonly state: InMemoryState) {}

  private toDomain(stored: StoredAccount): Account {
    return new Account({
      ...stored.props,
      balance: Money.fromCents(stored.balanceCents),
      createdAt: stored.createdAt,
      updatedAt: stored.createdAt,
    });
  }

  insert(account: NewAccount): Promise<Account> {
    for (const a of this.state.accounts.values()) {
      if (a.props.document.value === account.document.value) {
        return Promise.reject(new DocumentAlreadyRegisteredError());
      }
    }
    const stored = {
      props: account,
      balanceCents: account.balance.cents,
      createdAt: this.state.clock,
    };
    this.state.accounts.set(account.id, stored);
    return Promise.resolve(this.toDomain(stored));
  }

  findById(id: string): Promise<Account | null> {
    const stored = this.state.accounts.get(id);
    return Promise.resolve(stored ? this.toDomain(stored) : null);
  }

  lockByIds(ids: readonly string[]): Promise<Account[]> {
    return Promise.resolve(
      [...ids].sort().flatMap((id) => {
        const stored = this.state.accounts.get(id);
        return stored ? [this.toDomain(stored)] : [];
      }),
    );
  }

  saveBalances(accounts: readonly Account[]): Promise<void> {
    for (const account of accounts) {
      const stored = this.state.accounts.get(account.id);
      if (stored) stored.balanceCents = account.balance.cents;
    }
    return Promise.resolve();
  }
}

export class FakeLedger implements LedgerRepository {
  constructor(private readonly state: InMemoryState) {}
  append(entries: readonly NewLedgerEntry[]): Promise<void> {
    this.state.ledger.push(...entries);
    return Promise.resolve();
  }
}

export class FakeTransfers implements TransferRepository {
  constructor(private readonly state: InMemoryState) {}
  insert(transfer: NewTransfer): Promise<Transfer> {
    const created: Transfer = { ...transfer, status: 'COMPLETED', createdAt: this.state.clock };
    this.state.transfers.set(created.id, created);
    return Promise.resolve(created);
  }
  findById(id: string): Promise<Transfer | null> {
    return Promise.resolve(this.state.transfers.get(id) ?? null);
  }
}

export class FakeIdempotency implements IdempotencyStore {
  constructor(private readonly state: InMemoryState) {}
  acquire(input: {
    clientId: string;
    key: string;
    requestHash: string;
  }): Promise<IdempotencyAcquireResult> {
    const id = `${input.clientId}:${input.key}`;
    const existing = this.state.keys.get(id);
    if (!existing) {
      this.state.keys.set(id, { requestHash: input.requestHash });
      return Promise.resolve({ kind: 'acquired' });
    }
    if (existing.requestHash !== input.requestHash) return Promise.resolve({ kind: 'mismatch' });
    return Promise.resolve({ kind: 'replay', status: existing.status ?? 0, body: existing.body! });
  }
  complete(input: {
    clientId: string;
    key: string;
    status: number;
    body: TransferResponse;
  }): Promise<void> {
    const stored = this.state.keys.get(`${input.clientId}:${input.key}`);
    if (stored) Object.assign(stored, { status: input.status, body: input.body });
    return Promise.resolve();
  }
}

export class FakeOutbox implements OutboxWriter {
  constructor(private readonly state: InMemoryState) {}
  add(event: TransferCompletedEventV1): Promise<void> {
    this.state.outbox.push(event);
    return Promise.resolve();
  }
}

export class FakeStatement implements StatementRepository {
  calls: { accountId: string; limit: number; after?: StatementPosition }[] = [];
  constructor(private readonly entries: StatementEntry[]) {}
  page(accountId: string, limit: number, after?: StatementPosition): Promise<StatementEntry[]> {
    this.calls.push({ accountId, limit, after });
    const start = after ? this.entries.findIndex((e) => e.id === after.id) + 1 : 0;
    return Promise.resolve(this.entries.slice(start, start + limit));
  }
}

export function createFakes() {
  const state = new InMemoryState();
  return {
    state,
    uow: new FakeUnitOfWork(state),
    ids: new SequentialIds(),
    accounts: new FakeAccounts(state),
    ledger: new FakeLedger(state),
    transfers: new FakeTransfers(state),
    idempotency: new FakeIdempotency(state),
    outbox: new FakeOutbox(state),
  };
}
