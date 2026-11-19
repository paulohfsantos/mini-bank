import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7 [PERF-10]', () => {
  it('tem versão 7 e variante RFC 9562', () => {
    for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(V7);
  });

  it('codifica o instante em milissegundos nos 48 bits iniciais', () => {
    // No futuro: o gerador guarda estado no processo e nunca anda para trás.
    const at = Date.now() + 60_000;
    const hex = uuidv7(at).replaceAll('-', '').slice(0, 12);
    expect(parseInt(hex, 16)).toBe(at);
  });

  it('é estritamente crescente na mesma milissegundo e com o relógio voltando', () => {
    const now = Date.now();
    const ids = [
      ...Array.from({ length: 5000 }, () => uuidv7(now)),
      uuidv7(now - 1000), // relógio voltou: continua crescente
      uuidv7(now + 1),
    ];
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
