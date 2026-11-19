import { StatementPageSchema } from '@mini-banco/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakes, FakeStatement } from '../../../../test/support/fakes';
import { AccountNotFoundError, InvalidCursorError } from '../../../shared/domain/errors';
import { Money } from '../../../shared/domain/money';
import { Cpf } from '../../accounts/domain/cpf';
import { decodeCursor, encodeCursor } from './cursor';
import { GetStatementUseCase } from './get-statement.use-case';
import type { StatementEntry } from './ports';

describe('cursor do extrato (STM-BR-06)', () => {
  const position = {
    createdAtMicros: 1_795_000_000_123_456n,
    id: '0193a1b2-7c4d-7e5f-8a6b-000000000001',
  };

  it('ida e volta preserva microssegundos e id', () => {
    const cursor = encodeCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(position);
  });

  it.each([
    ['não é base64url', '!!!'],
    ['base64 com padding', `${encodeCursor(position)}=`],
    ['base64url de texto que não é JSON', Buffer.from('oi').toString('base64url')],
    ['JSON sem os campos', Buffer.from('{}').toString('base64url')],
    [
      'campo extra',
      Buffer.from(JSON.stringify({ t: '1', i: position.id, x: 1 })).toString('base64url'),
    ],
    ['id que não é UUID', Buffer.from(JSON.stringify({ t: '1', i: 'abc' })).toString('base64url')],
    [
      'instante negativo',
      Buffer.from(JSON.stringify({ t: '-1', i: position.id })).toString('base64url'),
    ],
    [
      'instante decimal',
      Buffer.from(JSON.stringify({ t: '1.5', i: position.id })).toString('base64url'),
    ],
    ['tipos trocados', Buffer.from(JSON.stringify({ t: 1, i: position.id })).toString('base64url')],
  ])('[STM-AC-03] rejeita cursor %s com InvalidCursorError', (_caso, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(InvalidCursorError);
  });
});

describe('GetStatementUseCase', () => {
  let f: ReturnType<typeof createFakes>;
  let accountId: string;

  const entry = (n: number): StatementEntry => ({
    id: `0193a1b2-7c4d-7e5f-8a6b-${n.toString().padStart(12, '0')}`,
    type: 'CREDIT',
    amount: Money.fromCents(100),
    balanceAfter: Money.fromCents(100 * n),
    transferId: `0193a1b2-7c4d-7e5f-8a6b-${(1000 + n).toString().padStart(12, '0')}`,
    counterpartyAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000bb',
    createdAt: new Date(Date.UTC(2026, 10, 18, 12, 0, n)),
    position: {
      createdAtMicros: BigInt(n) * 1_000_000n,
      id: `0193a1b2-7c4d-7e5f-8a6b-${n.toString().padStart(12, '0')}`,
    },
  });

  beforeEach(async () => {
    f = createFakes();
    accountId = f.ids.next();
    await f.accounts.insert({
      id: accountId,
      holderName: 'A',
      document: Cpf.parse('52998224725'),
      balance: Money.ZERO,
    });
  });

  it('[STM-AC-02] pede limit+1 para saber se há próxima página, sem COUNT (STM-NFR-02)', async () => {
    const repo = new FakeStatement(Array.from({ length: 5 }, (_, i) => entry(5 - i)));
    const page = await new GetStatementUseCase(f.accounts, repo).execute({ accountId, limit: 2 });

    expect(StatementPageSchema.parse(page).items).toHaveLength(2);
    expect(repo.calls[0]?.limit).toBe(3);
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor(page.nextCursor!)).toEqual(entry(4).position);
  });

  it('[STM-AC-02] nextCursor é null na última página', async () => {
    const repo = new FakeStatement([entry(2), entry(1)]);
    const page = await new GetStatementUseCase(f.accounts, repo).execute({ accountId, limit: 2 });
    expect(page.nextCursor).toBeNull();
  });

  it('[STM-AC-04] conta inexistente lança AccountNotFoundError (não página vazia)', async () => {
    const repo = new FakeStatement([]);
    await expect(
      new GetStatementUseCase(f.accounts, repo).execute({ accountId: f.ids.next(), limit: 20 }),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
  });

  it('[STM-AC-03] cursor inválido falha antes de consultar o banco', async () => {
    const repo = new FakeStatement([]);
    await expect(
      new GetStatementUseCase(f.accounts, repo).execute({ accountId, limit: 20, cursor: 'xx' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
    expect(repo.calls).toHaveLength(0);
  });
});
