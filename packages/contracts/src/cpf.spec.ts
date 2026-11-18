import { isValidCpf, maskCpf } from './cpf';

describe('isValidCpf (ACC-BR-01)', () => {
  it.each(['52998224725', '11144477735', '39053344705'])('aceita CPF válido %s', (cpf) => {
    expect(isValidCpf(cpf)).toBe(true);
  });

  it.each([
    ['dígito verificador errado', '52998224724'],
    ['primeiro dígito verificador errado', '52998224735'],
    ['sequência repetida', '11111111111'],
    ['zeros', '00000000000'],
    ['10 dígitos', '5299822472'],
    ['12 dígitos', '529982247250'],
    ['com pontuação', '529.982.247-25'],
    ['com letras', '5299822472a'],
    ['vazio', ''],
  ])('[ACC-AC-04] rejeita %s', (_caso, cpf) => {
    expect(isValidCpf(cpf)).toBe(false);
  });
});

describe('maskCpf (ACC-BR-06)', () => {
  it('[ACC-AC-10] mostra só os 6 dígitos do meio', () => {
    expect(maskCpf('52998224725')).toBe('***.982.247-**');
  });

  it('recusa valor que não tem 11 dígitos', () => {
    expect(() => maskCpf('123')).toThrow();
  });
});
