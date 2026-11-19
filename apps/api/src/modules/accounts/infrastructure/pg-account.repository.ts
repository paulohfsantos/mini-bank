import { type Database, isUniqueViolation, ResourceBusyError } from '@mini-banco/database';
import { AccountBusyError, DocumentAlreadyRegisteredError } from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';
import type { AccountRepository, NewAccount } from '../application/ports';
import { Account } from '../domain/account';
import { Cpf } from '../domain/cpf';

interface AccountRow {
  id: string;
  holder_name: string;
  document: string;
  balance_cents: bigint;
  created_at: Date;
  updated_at: Date;
}

// SQL montado uma vez com a lista fixa de colunas; valores sempre em parâmetros (SEC-09).
const COLUMNS = 'id, holder_name, document, balance_cents, created_at, updated_at';
const INSERT_SQL = `
  INSERT INTO accounts (id, holder_name, document, balance_cents)
  VALUES ($1, $2, $3, $4::bigint)
  RETURNING ${COLUMNS}`;
const FIND_BY_ID_SQL = `SELECT ${COLUMNS} FROM accounts WHERE id = $1`;
/**
 * TRF-BR-05 / PERF-08: o ORDER BY fica abaixo do LockRows no plano, então as linhas são
 * travadas em ordem crescente de id. Toda transação trava na mesma ordem: sem deadlock
 * entre A→B e B→A.
 */
const LOCK_BY_IDS_SQL = `SELECT ${COLUMNS} FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`;
const SAVE_BALANCES_SQL = `
  UPDATE accounts AS a
     SET balance_cents = v.balance_cents, updated_at = now()
    FROM unnest($1::uuid[], $2::bigint[]) AS v(id, balance_cents)
   WHERE a.id = v.id`;

function toDomain(row: AccountRow): Account {
  return new Account({
    id: row.id,
    holderName: row.holder_name,
    document: Cpf.parse(row.document),
    balance: Money.fromCents(row.balance_cents),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class PgAccountRepository implements AccountRepository {
  constructor(private readonly db: Database) {}

  async insert(account: NewAccount): Promise<Account> {
    try {
      const { rows } = await this.db.query<AccountRow>(INSERT_SQL, [
        account.id,
        account.holderName,
        account.document.value,
        account.balance.toString(),
      ]);
      return toDomain(rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error, 'accounts_document_key'))
        throw new DocumentAlreadyRegisteredError();
      throw error;
    }
  }

  async findById(id: string): Promise<Account | null> {
    const { rows } = await this.db.query<AccountRow>(FIND_BY_ID_SQL, [id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async lockByIds(ids: readonly string[]): Promise<Account[]> {
    try {
      const { rows } = await this.db.query<AccountRow>(LOCK_BY_IDS_SQL, [ids]);
      return rows.map(toDomain);
    } catch (error) {
      if (error instanceof ResourceBusyError) throw new AccountBusyError({ cause: error });
      throw error;
    }
  }

  async saveBalances(accounts: readonly Account[]): Promise<void> {
    await this.db.query(SAVE_BALANCES_SQL, [
      accounts.map((a) => a.id),
      accounts.map((a) => a.balance.toString()),
    ]);
  }
}
