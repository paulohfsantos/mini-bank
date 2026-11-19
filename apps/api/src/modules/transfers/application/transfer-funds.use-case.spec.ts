import { TransferCompletedEventV1Schema, TransferSchema } from '@mini-banco/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakes } from '../../../../test/support/fakes';
import {
  AccountNotFoundError,
  IdempotencyKeyReusedError,
  InsufficientFundsError,
  SameAccountError,
} from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';
import { Cpf } from '../../accounts/domain/cpf';
import type { OutboxWriter } from './ports';
import { hashTransferRequest } from './request-hash';
import { type TransferFundsCommand, TransferFundsUseCase } from './transfer-funds.use-case';

let f: ReturnType<typeof createFakes>;
let A: string;
let B: string;

function useCase(outbox: OutboxWriter = f.outbox) {
  return new TransferFundsUseCase(
    f.uow,
    f.ids,
    f.accounts,
    f.ledger,
    f.transfers,
    f.idempotency,
    outbox,
  );
}

function command(overrides: Partial<TransferFundsCommand> = {}): TransferFundsCommand {
  return {
    clientId: 'web',
    idempotencyKey: 'k-1',
    sourceAccountId: A,
    destinationAccountId: B,
    amountCents: 15_000,
    correlationId: 'c-123',
    ...overrides,
  };
}

beforeEach(async () => {
  f = createFakes();
  A = f.ids.next();
  B = f.ids.next();
  await f.accounts.insert({
    id: A,
    holderName: 'A',
    document: Cpf.parse('52998224725'),
    balance: Money.fromCents(100_000),
  });
  await f.accounts.insert({
    id: B,
    holderName: 'B',
    document: Cpf.parse('11144477735'),
    balance: Money.fromCents(0),
  });
});

describe('TransferFundsUseCase', () => {
  it('[TRF-AC-01] debita, credita, grava transferência, dois lançamentos, outbox e chave', async () => {
    const result = await useCase().execute(command());

    expect(result.replayed).toBe(false);
    expect(result.status).toBe(201);
    expect(TransferSchema.parse(result.body)).toMatchObject({
      sourceAccountId: A,
      destinationAccountId: B,
      amountCents: 15_000,
      status: 'COMPLETED',
    });
    expect(f.state.accounts.get(A)?.balanceCents).toBe(85_000n);
    expect(f.state.accounts.get(B)?.balanceCents).toBe(15_000n);
    expect(
      f.state.ledger.map((e) => [
        e.accountId,
        e.type,
        e.amount.cents,
        e.balanceAfter.cents,
        e.transferId,
      ]),
    ).toEqual([
      [A, 'DEBIT', 15_000n, 85_000n, result.body.id],
      [B, 'CREDIT', 15_000n, 15_000n, result.body.id],
    ]);
  });

  it('[TRF-AC-19] gera exatamente um evento transfer.completed válido no schema', async () => {
    const { body } = await useCase().execute(command());
    expect(f.state.outbox).toHaveLength(1);
    const event = TransferCompletedEventV1Schema.parse(f.state.outbox[0]);
    expect(event).toMatchObject({
      eventType: 'transfer.completed',
      correlationId: 'c-123',
      data: { transferId: body.id, amountCents: 15_000, completedAt: body.createdAt },
    });
    expect(event.eventId).not.toBe(body.id);
  });

  it('[TRF-AC-08] origem = destino lança SameAccountError antes de qualquer escrita', async () => {
    await expect(useCase().execute(command({ destinationAccountId: A }))).rejects.toBeInstanceOf(
      SameAccountError,
    );
    expect(f.state.keys.size).toBe(0);
  });

  it.each([
    ['source', () => ({ sourceAccountId: '0193a1b2-7c4d-7e5f-8a6b-999999999999' })],
    ['destination', () => ({ destinationAccountId: '0193a1b2-7c4d-7e5f-8a6b-999999999999' })],
  ] as const)('[TRF-AC-09] conta inexistente informa o papel %s', async (role, overrides) => {
    const error: unknown = await useCase()
      .execute(command(overrides()))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountNotFoundError);
    expect((error as AccountNotFoundError).role).toBe(role);
  });

  it('[TRF-AC-02] saldo insuficiente não altera nada (nem a chave)', async () => {
    const before = structuredClone([...f.state.accounts.values()].map((a) => a.balanceCents));
    await expect(useCase().execute(command({ amountCents: 100_001 }))).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    expect([...f.state.accounts.values()].map((a) => a.balanceCents)).toEqual(before);
    expect(
      f.state.transfers.size + f.state.ledger.length + f.state.outbox.length + f.state.keys.size,
    ).toBe(0);
  });

  it('[TRF-AC-04] mesma chave e mesmo payload devolve a resposta original, sem nova transferência', async () => {
    const first = await useCase().execute(command());
    const second = await useCase().execute(command());
    expect(second).toEqual({ replayed: true, status: 201, body: first.body });
    expect(f.state.transfers.size).toBe(1);
    expect(f.state.accounts.get(A)?.balanceCents).toBe(85_000n);
  });

  it('[TRF-AC-05] mesma chave e payload diferente lança IdempotencyKeyReusedError e nada muda', async () => {
    await useCase().execute(command());
    await expect(useCase().execute(command({ amountCents: 20_000 }))).rejects.toBeInstanceOf(
      IdempotencyKeyReusedError,
    );
    expect(f.state.transfers.size).toBe(1);
  });

  it('[TRF-BR-08] a mesma chave de outro cliente é independente', async () => {
    await useCase().execute(command());
    const other = await useCase().execute(command({ clientId: 'outro' }));
    expect(other.replayed).toBe(false);
    expect(f.state.transfers.size).toBe(2);
  });

  it('[TRF-AC-18] falha não consome a chave: repetir depois de repor o saldo executa', async () => {
    await expect(useCase().execute(command({ amountCents: 150_000 }))).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    f.state.accounts.get(A)!.balanceCents = 200_000n;
    const retry = await useCase().execute(command({ amountCents: 150_000 }));
    expect(retry.replayed).toBe(false);
  });

  it('[TRF-AC-11] erro ao gravar o outbox desfaz tudo', async () => {
    const failing: OutboxWriter = { add: () => Promise.reject(new Error('outbox indisponível')) };
    await expect(useCase(failing).execute(command())).rejects.toThrow('outbox indisponível');
    expect(f.state.accounts.get(A)?.balanceCents).toBe(100_000n);
    expect(f.state.transfers.size + f.state.ledger.length + f.state.keys.size).toBe(0);
  });
});

describe('hashTransferRequest (TRF-BR-09)', () => {
  const base = { sourceAccountId: 'a', destinationAccountId: 'b', amountCents: 1 };

  it('independe da ordem das chaves e é SHA-256 hex', () => {
    const reordered = { amountCents: 1, destinationAccountId: 'b', sourceAccountId: 'a' };
    expect(hashTransferRequest(base)).toBe(hashTransferRequest(reordered));
    expect(hashTransferRequest(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda com qualquer campo', () => {
    expect(hashTransferRequest({ ...base, amountCents: 2 })).not.toBe(hashTransferRequest(base));
    expect(hashTransferRequest({ ...base, destinationAccountId: 'c' })).not.toBe(
      hashTransferRequest(base),
    );
  });
});
