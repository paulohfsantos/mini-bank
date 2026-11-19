import { AccountSchema } from '@mini-banco/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakes } from '../../../../test/support/fakes';
import {
  AccountNotFoundError,
  DocumentAlreadyRegisteredError,
  InvalidDocumentError,
} from '../../../shared/domain/errors';
import { CreateAccountUseCase } from './create-account.use-case';
import { GetAccountUseCase } from './get-account.use-case';

let f: ReturnType<typeof createFakes>;
let create: CreateAccountUseCase;

beforeEach(() => {
  f = createFakes();
  create = new CreateAccountUseCase(f.uow, f.ids, f.accounts, f.ledger);
});

const input = {
  holderName: 'Maria da Silva',
  document: '52998224725',
  initialBalanceCents: 150_000,
};

describe('CreateAccountUseCase', () => {
  it('[ACC-AC-01] cria a conta com o saldo inicial e um lançamento OPENING', async () => {
    const account = await create.execute(input);
    expect(AccountSchema.parse(account)).toMatchObject({
      holderName: 'Maria da Silva',
      balanceCents: 150_000,
    });
    expect(f.state.ledger).toHaveLength(1);
    expect(f.state.ledger[0]).toMatchObject({
      accountId: account.id,
      type: 'OPENING',
      transferId: null,
    });
    expect(f.state.ledger[0]?.amount.cents).toBe(150_000n);
    expect(f.state.ledger[0]?.balanceAfter.cents).toBe(150_000n);
  });

  it('[ACC-BR-07] gera o OPENING mesmo com saldo inicial 0', async () => {
    await create.execute({ ...input, initialBalanceCents: 0 });
    expect(f.state.ledger[0]?.amount.cents).toBe(0n);
  });

  it('[ACC-AC-10] devolve só o CPF mascarado', async () => {
    const account = await create.execute(input);
    expect(account.documentMasked).toBe('***.982.247-**');
    expect(JSON.stringify(account)).not.toContain('52998224725');
  });

  it('[ACC-AC-02] CPF repetido lança DocumentAlreadyRegisteredError sem criar nada', async () => {
    await create.execute(input);
    await expect(create.execute({ ...input, holderName: 'Outra' })).rejects.toBeInstanceOf(
      DocumentAlreadyRegisteredError,
    );
    expect(f.state.accounts.size).toBe(1);
    expect(f.state.ledger).toHaveLength(1);
  });

  it('[ACC-AC-04] o domínio também rejeita CPF inválido (defesa além do schema)', async () => {
    await expect(create.execute({ ...input, document: '52998224724' })).rejects.toBeInstanceOf(
      InvalidDocumentError,
    );
  });
});

describe('GetAccountUseCase', () => {
  it('[ACC-AC-05] devolve a conta com o saldo atual', async () => {
    const created = await create.execute(input);
    const found = await new GetAccountUseCase(f.accounts).execute(created.id);
    expect(found).toEqual(created);
  });

  it('[ACC-AC-06] conta inexistente lança AccountNotFoundError', async () => {
    await expect(new GetAccountUseCase(f.accounts).execute(f.ids.next())).rejects.toBeInstanceOf(
      AccountNotFoundError,
    );
  });
});
