import { CreateTransferRequestSchema } from './transfers';

const valid = {
  sourceAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000aa',
  destinationAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000bb',
  amountCents: 15000,
};

describe('CreateTransferRequestSchema', () => {
  it('aceita payload válido, inclusive os limites 1 e 100.000.000', () => {
    expect(CreateTransferRequestSchema.safeParse(valid).success).toBe(true);
    expect(CreateTransferRequestSchema.safeParse({ ...valid, amountCents: 1 }).success).toBe(true);
    expect(
      CreateTransferRequestSchema.safeParse({ ...valid, amountCents: 100_000_000 }).success,
    ).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['negativo', -100],
    ['decimal', 150.5],
    ['string', '15000'],
    ['acima do teto', 100_000_001],
    ['NaN', Number.NaN],
  ])('[TRF-AC-10] rejeita amountCents %s', (_caso, amountCents) => {
    const result = CreateTransferRequestSchema.safeParse({ ...valid, amountCents });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['amountCents']);
  });

  it('rejeita ids que não são UUID e campos extras', () => {
    expect(
      CreateTransferRequestSchema.safeParse({ ...valid, sourceAccountId: 'abc' }).success,
    ).toBe(false);
    expect(CreateTransferRequestSchema.safeParse({ ...valid, note: 'oi' }).success).toBe(false);
  });

  it('não valida origem = destino no schema (TRF-BR-02 é regra de domínio, código SAME_ACCOUNT)', () => {
    const same = { ...valid, destinationAccountId: valid.sourceAccountId };
    expect(CreateTransferRequestSchema.safeParse(same).success).toBe(true);
  });
});
