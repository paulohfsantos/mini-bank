import type { Database } from '@mini-banco/database';
import { Money } from '../../../shared/domain/money';
import type { NewTransfer, TransferRepository } from '../application/ports';
import type { Transfer, TransferStatus } from '../domain/transfer';

interface TransferRow {
  id: string;
  source_account_id: string;
  destination_account_id: string;
  amount_cents: bigint;
  status: TransferStatus;
  correlation_id: string;
  created_at: Date;
}

const COLUMNS =
  'id, source_account_id, destination_account_id, amount_cents, status, correlation_id, created_at';
const INSERT_SQL = `
  INSERT INTO transfers (id, source_account_id, destination_account_id, amount_cents, status, correlation_id)
  VALUES ($1, $2, $3, $4::bigint, 'COMPLETED', $5)
  RETURNING ${COLUMNS}`;
const FIND_BY_ID_SQL = `SELECT ${COLUMNS} FROM transfers WHERE id = $1`;

function toDomain(row: TransferRow): Transfer {
  return {
    id: row.id,
    sourceAccountId: row.source_account_id,
    destinationAccountId: row.destination_account_id,
    amount: Money.fromCents(row.amount_cents),
    status: row.status,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
  };
}

export class PgTransferRepository implements TransferRepository {
  constructor(private readonly db: Database) {}

  async insert(transfer: NewTransfer): Promise<Transfer> {
    const { rows } = await this.db.query<TransferRow>(INSERT_SQL, [
      transfer.id,
      transfer.sourceAccountId,
      transfer.destinationAccountId,
      transfer.amount.toString(),
      transfer.correlationId,
    ]);
    return toDomain(rows[0]!);
  }

  async findById(id: string): Promise<Transfer | null> {
    const { rows } = await this.db.query<TransferRow>(FIND_BY_ID_SQL, [id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }
}
