import type { Transfer as TransferResponse } from '@mini-banco/contracts';
import type { IdGenerator, LedgerRepository, UnitOfWork } from '../../../shared/application/ports';
import { AccountNotFoundError, IdempotencyKeyReusedError } from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';
import type { AccountRepository } from '../../accounts/application/ports';
import { assertDistinctAccounts } from '../domain/transfer';
import type { IdempotencyStore, OutboxWriter, TransferRepository } from './ports';
import { hashTransferRequest } from './request-hash';
import { toTransferCompletedEvent, toTransferResponse } from './transfer-mappers';

export interface TransferFundsCommand {
  clientId: string;
  idempotencyKey: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  correlationId: string;
}

export interface TransferFundsResult {
  replayed: boolean;
  status: number;
  body: TransferResponse;
}

/**
 * Transferência síncrona (specs/transfers/spec.md). Ordem de validação TRF-BR-13 a partir
 * do passo 4; os passos 1–3 (auth, header, schema) ficam na borda HTTP.
 *
 * Numa única transação (TRF-BR-04), com locks sempre na mesma ordem (TRF-BR-05, PERF-08):
 *   chave de idempotência → contas por id crescente → escritas → resposta da chave.
 * Nenhuma chamada de rede acontece aqui dentro (TRF-NFR-04): o evento vai para o outbox.
 */
export class TransferFundsUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly ids: IdGenerator,
    private readonly accounts: AccountRepository,
    private readonly ledger: LedgerRepository,
    private readonly transfers: TransferRepository,
    private readonly idempotency: IdempotencyStore,
    private readonly outbox: OutboxWriter,
  ) {}

  async execute(command: TransferFundsCommand): Promise<TransferFundsResult> {
    const { clientId, idempotencyKey: key, sourceAccountId, destinationAccountId } = command;

    // (4) SAME_ACCOUNT: barato e sem estado, antes de tocar no banco.
    assertDistinctAccounts(sourceAccountId, destinationAccountId);
    const amount = Money.fromCents(command.amountCents);
    const requestHash = hashTransferRequest(command);

    return this.uow.run(async () => {
      // (5) Replay ou reuso da chave. Primeiro lock da transação.
      const acquired = await this.idempotency.acquire({ clientId, key, requestHash });
      if (acquired.kind === 'replay') {
        return { replayed: true, status: acquired.status, body: acquired.body };
      }
      if (acquired.kind === 'mismatch') throw new IdempotencyKeyReusedError();

      // (6) Existência, já com as duas contas travadas em ordem de id.
      const locked = await this.accounts.lockByIds([sourceAccountId, destinationAccountId]);
      const source = locked.find((a) => a.id === sourceAccountId);
      if (!source) throw new AccountNotFoundError('source');
      const destination = locked.find((a) => a.id === destinationAccountId);
      if (!destination) throw new AccountNotFoundError('destination');

      // (7) Saldo. Qualquer erro daqui em diante desfaz tudo, inclusive a chave (TRF-BR-11).
      source.debit(amount);
      destination.credit(amount);

      const transfer = await this.transfers.insert({
        id: this.ids.next(),
        sourceAccountId,
        destinationAccountId,
        amount,
        correlationId: command.correlationId,
      });
      await this.accounts.saveBalances([source, destination]);
      await this.ledger.append([
        {
          id: this.ids.next(),
          accountId: source.id,
          transferId: transfer.id,
          type: 'DEBIT',
          amount,
          balanceAfter: source.balance,
        },
        {
          id: this.ids.next(),
          accountId: destination.id,
          transferId: transfer.id,
          type: 'CREDIT',
          amount,
          balanceAfter: destination.balance,
        },
      ]);
      await this.outbox.add(toTransferCompletedEvent(this.ids.next(), transfer));

      const body = toTransferResponse(transfer);
      await this.idempotency.complete({
        clientId,
        key,
        transferId: transfer.id,
        status: 201,
        body,
      });
      return { replayed: false, status: 201, body };
    });
  }
}
