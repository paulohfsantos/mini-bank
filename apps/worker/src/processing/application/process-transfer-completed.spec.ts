import type { TransferCompletedEventV1 } from '@mini-banco/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakes } from '../../../test/support/fakes';
import { TransferMismatchError } from '../domain/errors';
import { ProcessTransferCompletedUseCase } from './process-transfer-completed';

const A = '0193a1b2-7c4d-7e5f-8a6b-0000000000aa';
const B = '0193a1b2-7c4d-7e5f-8a6b-0000000000bb';
const COMPLETED_AT = new Date('2026-11-18T14:00:00.000Z');

let f: ReturnType<typeof createFakes>;
let useCase: ProcessTransferCompletedUseCase;
let seq = 0;

beforeEach(() => {
  f = createFakes();
  useCase = new ProcessTransferCompletedUseCase(
    f.uow,
    f.ids,
    f.processed,
    f.transfers,
    f.reviews,
    f.notifications,
    f.notifier,
  );
});

/** Grava a transferência "no banco" e devolve o evento correspondente. */
function stored(
  amountCents: number,
  createdAt = COMPLETED_AT,
  source = A,
): TransferCompletedEventV1 {
  const transferId = `0193a1b2-7c4d-7e5f-8a6b-${String(++seq).padStart(12, '0')}`;
  f.state.transfers.set(transferId, {
    id: transferId,
    sourceAccountId: source,
    destinationAccountId: B,
    amountCents: BigInt(amountCents),
    createdAt,
  });
  return {
    eventId: `0193a1b2-7c4d-7e5f-8a6b-e${String(seq).padStart(11, '0')}`,
    eventType: 'transfer.completed',
    eventVersion: 1,
    occurredAt: createdAt.toISOString(),
    correlationId: 'c-1',
    data: {
      transferId,
      sourceAccountId: source,
      destinationAccountId: B,
      amountCents,
      completedAt: createdAt.toISOString(),
    },
  };
}

const minutesBefore = (m: number, s = 0) =>
  new Date(COMPLETED_AT.getTime() - m * 60_000 - s * 1000);

describe('ProcessTransferCompletedUseCase', () => {
  it('[PRC-AC-01] abaixo dos limites: CLEARED, TRANSFER_SENT e TRANSFER_RECEIVED, entregues após o commit', async () => {
    const event = stored(15_000);
    const result = await useCase.execute(event);

    expect(result.outcome).toBe('processed');
    expect(f.state.reviews).toEqual([
      expect.objectContaining({
        transferId: event.data.transferId,
        status: 'CLEARED',
        reasons: [],
        ruleVersion: '2026-11-v1',
      }),
    ]);
    expect(f.state.notifications.map((n) => [n.type, n.accountId])).toEqual([
      ['TRANSFER_SENT', A],
      ['TRANSFER_RECEIVED', B],
    ]);
    expect(f.state.delivered).toHaveLength(2);
  });

  it('[PRC-AC-02] 1.000.000 → FLAGGED HIGH_AMOUNT; 999.999 → CLEARED', async () => {
    await useCase.execute(stored(1_000_000));
    await useCase.execute(stored(999_999, COMPLETED_AT, '0193a1b2-7c4d-7e5f-8a6b-0000000000cc'));
    expect(f.state.reviews.map((r) => [r.status, r.reasons])).toEqual([
      ['FLAGGED', ['HIGH_AMOUNT']],
      ['CLEARED', []],
    ]);
  });

  it('[PRC-AC-03] 4 anteriores na janela + a atual → FLAGGED HIGH_VELOCITY', async () => {
    for (const m of [9, 6, 3, 1]) stored(100, minutesBefore(m));
    await useCase.execute(stored(100));
    expect(f.state.reviews.at(-1)).toMatchObject({ status: 'FLAGGED', reasons: ['HIGH_VELOCITY'] });
  });

  it('[PRC-AC-03] a de 10 min + 1 s antes não conta; a de exatamente 10 min conta (PERF-20)', async () => {
    const C = '0193a1b2-7c4d-7e5f-8a6b-0000000000cc';
    // Origem A: 3 dentro + 1 a 10 min e 1 s → só 4 na janela → CLEARED.
    for (const m of [6, 3, 1]) stored(100, minutesBefore(m));
    stored(100, minutesBefore(10, 1));
    await useCase.execute(stored(100));
    expect(f.state.reviews.at(-1)).toMatchObject({ status: 'CLEARED', reasons: [] });

    // Origem C: 3 dentro + 1 a exatamente 10 min → 5 na janela → FLAGGED.
    for (const m of [6, 3, 1]) stored(100, minutesBefore(m), C);
    stored(100, minutesBefore(10), C);
    await useCase.execute(stored(100, COMPLETED_AT, C));
    expect(f.state.reviews.at(-1)).toMatchObject({ status: 'FLAGGED', reasons: ['HIGH_VELOCITY'] });
  });

  it('[PRC-AC-03] processar com 1 h de atraso dá o mesmo resultado (janela relativa ao completedAt)', async () => {
    // O use case não tem relógio: só o completedAt do evento define a janela.
    for (const m of [8, 6, 4, 2]) stored(100, minutesBefore(m));
    const event = stored(100);
    const later = {
      ...event,
      occurredAt: new Date(COMPLETED_AT.getTime() + 3_600_000).toISOString(),
    };
    await useCase.execute(later);
    expect(f.state.reviews.at(-1)?.reasons).toEqual(['HIGH_VELOCITY']);
  });

  it('[PRC-AC-04] mesmo eventId duas vezes: uma revisão, duas notificações', async () => {
    const event = stored(15_000);
    await useCase.execute(event);
    expect((await useCase.execute(event)).outcome).toBe('duplicate');
    expect(f.state.reviews).toHaveLength(1);
    expect(f.state.notifications).toHaveLength(2);
    expect(f.state.delivered).toHaveLength(2);
  });

  it.each([
    [
      'transferência inexistente',
      (e: TransferCompletedEventV1) => ({
        ...e,
        data: { ...e.data, transferId: '0193a1b2-7c4d-7e5f-8a6b-ffffffffffff' },
      }),
      ['missing'],
    ],
    [
      'valor divergente',
      (e: TransferCompletedEventV1) => ({ ...e, data: { ...e.data, amountCents: 1 } }),
      ['amountCents'],
    ],
    [
      'contas trocadas',
      (e: TransferCompletedEventV1) => ({
        ...e,
        data: { ...e.data, sourceAccountId: B, destinationAccountId: A },
      }),
      ['sourceAccountId', 'destinationAccountId'],
    ],
  ])(
    '[PRC-AC-08] %s → TransferMismatchError e nenhum efeito (nem processed_messages)',
    async (_c, tamper, fields) => {
      const event = tamper(stored(15_000));
      const error = await useCase.execute(event).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(TransferMismatchError);
      expect((error as TransferMismatchError).fields).toEqual(fields);
      expect(f.state.processed.size).toBe(0);
      expect(f.state.reviews).toEqual([]);
      expect(f.state.notifications).toEqual([]);
      expect(f.state.delivered).toEqual([]);
    },
  );
});
