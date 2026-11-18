import { StatementQuerySchema } from './statement';

describe('StatementQuerySchema (STM-BR-05, STM-BR-06)', () => {
  it('usa limit 20 quando ausente', () => {
    expect(StatementQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('converte limit da query string', () => {
    expect(StatementQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(StatementQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it.each(['0', '101', '', '-1', '1.5', 'abc', '20abc'])('rejeita limit "%s"', (limit) => {
    expect(StatementQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('aceita cursor base64url e rejeita outros caracteres', () => {
    expect(StatementQuerySchema.safeParse({ cursor: 'eyJ0IjoxfQ' }).success).toBe(true);
    expect(StatementQuerySchema.safeParse({ cursor: 'eyJ0IjoxfQ==' }).success).toBe(false);
    expect(StatementQuerySchema.safeParse({ cursor: "'; DROP TABLE x" }).success).toBe(false);
    expect(StatementQuerySchema.safeParse({ cursor: 'a'.repeat(201) }).success).toBe(false);
  });

  it('ignora parâmetros desconhecidos na query', () => {
    expect(StatementQuerySchema.parse({ foo: 'bar' })).toEqual({ limit: 20 });
  });
});
