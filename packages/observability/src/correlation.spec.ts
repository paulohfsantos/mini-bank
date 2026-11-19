import { describe, expect, it } from 'vitest';
import { getCorrelationId, resolveCorrelationId, runWithCorrelationId } from './correlation';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveCorrelationId [SEC-12]', () => {
  it.each(['c-123', '0193a1b2-7c4d-7e5f-8a6b-000000000001', 'A'.repeat(64)])(
    'aceita valor válido %s',
    (value) => {
      expect(resolveCorrelationId(value)).toBe(value);
    },
  );

  it.each([
    ['ausente', undefined],
    ['vazio', ''],
    ['65 caracteres', 'a'.repeat(65)],
    ['quebra de linha', 'abc\ndef'],
    ['espaço', 'abc def'],
    ['underscore', 'abc_def'],
    ['header repetido (array)', ['a', 'b']],
  ])('gera UUID novo quando %s', (_caso, value) => {
    expect(resolveCorrelationId(value)).toMatch(UUID);
  });
});

describe('contexto de correlação (AsyncLocalStorage)', () => {
  it('fora de um contexto não há correlationId', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('propaga o id através de await e não vaza entre contextos concorrentes', async () => {
    const seen = await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        runWithCorrelationId(id, async () => {
          await new Promise((r) => setTimeout(r, 5));
          return getCorrelationId();
        }),
      ),
    );
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(getCorrelationId()).toBeUndefined();
  });
});
