// CPFs de teste: válidos (dígitos verificadores corretos), mas gerados, nunca reais (SEC-21).
let counter = 100_000_000;

function digit(base: string): number {
  const len = base.length;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += Number(base[i]) * (len + 1 - i);
  const r = (sum * 10) % 11;
  return r === 10 ? 0 : r;
}

/** CPF válido a partir de 9 dígitos. */
export function cpfFrom(nineDigits: string): string {
  const d1 = digit(nineDigits);
  const d2 = digit(nineDigits + d1);
  return `${nineDigits}${d1}${d2}`;
}

/** Um CPF válido diferente a cada chamada. */
export function nextCpf(): string {
  counter += 7919; // passo primo: evita sequências de dígito repetido
  return cpfFrom(String(counter).padStart(9, '0').slice(-9));
}
