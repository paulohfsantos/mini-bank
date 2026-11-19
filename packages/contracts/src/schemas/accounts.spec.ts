import { describe, expect, it } from 'vitest';
import { CreateAccountRequestSchema } from './accounts';

const valid = {
  holderName: 'Maria da Silva',
  document: '52998224725',
  initialBalanceCents: 150000,
};

/** Campos com erro (sem repetição: um campo pode violar mais de uma regra). */
function issuesFor(input: unknown) {
  const result = CreateAccountRequestSchema.safeParse(input);
  return result.success ? [] : [...new Set(result.error.issues.map((i) => i.path.join('.')))];
}

describe('CreateAccountRequestSchema', () => {
  it('aceita payload válido', () => {
    expect(CreateAccountRequestSchema.parse(valid)).toEqual(valid);
  });

  it('aceita saldo inicial 0 e o teto exato', () => {
    expect(issuesFor({ ...valid, initialBalanceCents: 0 })).toEqual([]);
    expect(issuesFor({ ...valid, initialBalanceCents: 10_000_000 })).toEqual([]);
  });

  it.each([
    ['negativo', -1],
    ['decimal', 10.5],
    ['string', '100'],
    ['acima do teto', 10_000_001],
    ['acima de Number.MAX_SAFE_INTEGER', 2 ** 53],
  ])('[ACC-AC-03] rejeita saldo inicial %s', (_caso, initialBalanceCents) => {
    expect(issuesFor({ ...valid, initialBalanceCents })).toEqual(['initialBalanceCents']);
  });

  it.each([
    ['dígito verificador errado', '52998224724'],
    ['sequência repetida', '22222222222'],
    ['com pontuação', '529.982.247-25'],
    ['curto', '529982247'],
  ])('[ACC-AC-04] rejeita CPF %s apontando o campo document', (_caso, document) => {
    expect(issuesFor({ ...valid, document })).toEqual(['document']);
  });

  it('[ACC-AC-08] rejeita campo não previsto', () => {
    const result = CreateAccountRequestSchema.safeParse({ ...valid, balanceCents: 1 });
    expect(result.success).toBe(false);
  });

  describe('holderName (ACC-BR-04)', () => {
    it('[ACC-AC-09] apara espaços e normaliza para NFC', () => {
      const nfd = 'José Conceição'; // "José Conceição" decomposto
      const parsed = CreateAccountRequestSchema.parse({ ...valid, holderName: `  ${nfd}  ` });
      expect(parsed.holderName).toBe('José Conceição');
      expect(parsed.holderName).toBe(parsed.holderName.normalize('NFC'));
    });

    it.each([
      ['vazio', ''],
      ['só espaços', '    '],
      ['com quebra de linha', 'Maria\nSilva'],
      ['com NUL', 'Maria\u0000'],
      ['com DEL', 'Maria\u007F'],
      ['com 121 caracteres', 'a'.repeat(121)],
    ])('[ACC-AC-09] rejeita nome %s', (_caso, holderName) => {
      expect(issuesFor({ ...valid, holderName })).toEqual(['holderName']);
    });

    it('aceita exatamente 120 caracteres', () => {
      expect(issuesFor({ ...valid, holderName: 'a'.repeat(120) })).toEqual([]);
    });
  });
});
