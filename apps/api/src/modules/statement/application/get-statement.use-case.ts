import type { StatementPage } from '@mini-banco/contracts';
import { AccountNotFoundError } from '../../../shared/domain/errors';
import type { AccountRepository } from '../../accounts/application/ports';
import { decodeCursor, encodeCursor } from './cursor';
import type { StatementEntry, StatementRepository } from './ports';

export interface GetStatementQuery {
  accountId: string;
  limit: number;
  cursor?: string;
}

/**
 * Extrato com keyset pagination (ADR-0016). Busca limit + 1 para saber se existe
 * próxima página sem COUNT(*) (STM-NFR-02). A conta vem do path, nunca do cursor (SEC-16).
 */
export class GetStatementUseCase {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly statement: StatementRepository,
  ) {}

  async execute(query: GetStatementQuery): Promise<StatementPage> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);

    const account = await this.accounts.findById(query.accountId);
    if (!account) throw new AccountNotFoundError();

    const rows = await this.statement.page(query.accountId, query.limit + 1, after);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    const nextCursor = rows.length > query.limit && last ? encodeCursor(last.position) : null;

    return { items: items.map(toEntryResponse), nextCursor };
  }
}

function toEntryResponse(entry: StatementEntry): StatementPage['items'][number] {
  return {
    id: entry.id,
    type: entry.type,
    amountCents: entry.amount.toSafeNumber(),
    balanceAfterCents: entry.balanceAfter.toSafeNumber(),
    transferId: entry.transferId,
    counterpartyAccountId: entry.counterpartyAccountId,
    createdAt: entry.createdAt.toISOString(),
  };
}
