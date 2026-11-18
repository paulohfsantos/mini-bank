// Testes de contrato: o openapi.yaml (fonte de verdade) e os schemas zod precisam concordar.
// 1. Todo exemplo do contrato é válido no próprio contrato (ajv) e no zod correspondente.
// 2. Para uma tabela de entradas, ajv e zod dão o mesmo veredito, exceto as divergências
//    listadas explicitamente (regras que o JSON Schema não consegue expressar).
import type { ZodType } from 'zod';
import { AccountSchema, CreateAccountRequestSchema } from './schemas/accounts';
import { HealthSchema, ProblemSchema } from './schemas/common';
import { StatementPageSchema } from './schemas/statement';
import { CreateTransferRequestSchema, TransferSchema } from './schemas/transfers';
import { collectExamples, createOpenApiValidator, loadOpenApi } from './test-support/openapi';

const doc = loadOpenApi();
const validateOas = createOpenApiValidator(doc);

const ZOD_BY_SCHEMA: Record<string, ZodType> = {
  CreateAccountRequest: CreateAccountRequestSchema,
  Account: AccountSchema,
  CreateTransferRequest: CreateTransferRequestSchema,
  Transfer: TransferSchema,
  StatementPage: StatementPageSchema,
  Problem: ProblemSchema,
  Health: HealthSchema,
};

describe('exemplos do openapi.yaml', () => {
  const examples = collectExamples(doc);

  it('existem exemplos para todos os schemas mapeados', () => {
    const covered = new Set(examples.map((e) => e.schema));
    expect([...covered].sort()).toEqual(Object.keys(ZOD_BY_SCHEMA).sort());
  });

  it.each(examples.map((e) => [e.label, e] as const))('%s', (_label, example) => {
    const zod = ZOD_BY_SCHEMA[example.schema];
    if (!zod) throw new Error(`sem schema zod para ${example.schema}`);

    expect(validateOas(example.schema, example.value)).toBe(true);
    const parsed = zod.safeParse(example.value);
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
});

describe('ajv (contrato) e zod concordam', () => {
  const account = { holderName: 'Maria', document: '52998224725', initialBalanceCents: 100 };
  const transfer = {
    sourceAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000aa',
    destinationAccountId: '0193a1b2-7c4d-7e5f-8a6b-0000000000bb',
    amountCents: 100,
  };

  const cases: [string, string, unknown][] = [
    ['conta válida', 'CreateAccountRequest', account],
    ['saldo negativo', 'CreateAccountRequest', { ...account, initialBalanceCents: -1 }],
    ['saldo decimal', 'CreateAccountRequest', { ...account, initialBalanceCents: 1.5 }],
    [
      'saldo acima do teto',
      'CreateAccountRequest',
      { ...account, initialBalanceCents: 10_000_001 },
    ],
    ['CPF com pontuação', 'CreateAccountRequest', { ...account, document: '529.982.247-25' }],
    ['nome com controle', 'CreateAccountRequest', { ...account, holderName: 'a\tb' }],
    ['nome com 121', 'CreateAccountRequest', { ...account, holderName: 'a'.repeat(121) }],
    ['campo extra', 'CreateAccountRequest', { ...account, extra: true }],
    ['sem document', 'CreateAccountRequest', { holderName: 'Maria', initialBalanceCents: 1 }],
    ['transferência válida', 'CreateTransferRequest', transfer],
    ['valor zero', 'CreateTransferRequest', { ...transfer, amountCents: 0 }],
    ['valor acima do teto', 'CreateTransferRequest', { ...transfer, amountCents: 100_000_001 }],
    ['valor string', 'CreateTransferRequest', { ...transfer, amountCents: '100' }],
    ['id inválido', 'CreateTransferRequest', { ...transfer, sourceAccountId: 'x' }],
    ['transferência com campo extra', 'CreateTransferRequest', { ...transfer, memo: 'x' }],
  ];

  it.each(cases)('%s', (_label, schema, value) => {
    const zod = ZOD_BY_SCHEMA[schema];
    if (!zod) throw new Error(schema);
    expect(zod.safeParse(value).success).toBe(validateOas(schema, value));
  });

  // Divergências intencionais: o contrato aceita, o servidor rejeita. Se uma delas
  // deixar de divergir, o teste falha e a lista (e a spec) precisam ser revistas.
  const knownDivergences: [string, string, unknown][] = [
    [
      'dígito verificador do CPF (ACC-BR-01, só no servidor)',
      'CreateAccountRequest',
      { ...account, document: '52998224724' },
    ],
    [
      'nome só com espaços (trim antes do tamanho, ACC-BR-04)',
      'CreateAccountRequest',
      { ...account, holderName: '   ' },
    ],
  ];

  it.each(knownDivergences)('divergência documentada: %s', (_label, schema, value) => {
    const zod = ZOD_BY_SCHEMA[schema];
    if (!zod) throw new Error(schema);
    expect(validateOas(schema, value)).toBe(true);
    expect(zod.safeParse(value).success).toBe(false);
  });
});
