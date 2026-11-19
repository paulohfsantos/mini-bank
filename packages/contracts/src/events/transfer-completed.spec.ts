import { describe, expect, it } from 'vitest';
// O schema zod do evento precisa concordar com specs/events/transfer.completed.v1.schema.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { SPECS_DIR } from '../testing/openapi';
import { TransferCompletedEventV1Schema } from './transfer-completed';

interface EventJsonSchema {
  examples: unknown[];
}

const jsonSchema = JSON.parse(
  readFileSync(resolve(SPECS_DIR, 'events/transfer.completed.v1.schema.json'), 'utf8'),
) as EventJsonSchema;

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validateJson = ajv.compile(jsonSchema);

const example = jsonSchema.examples[0] as {
  data: Record<string, unknown>;
} & Record<string, unknown>;

function both(value: unknown) {
  return {
    jsonSchema: validateJson(value),
    zod: TransferCompletedEventV1Schema.safeParse(value).success,
  };
}

describe('transfer.completed v1', () => {
  it('o JSON Schema é válido e o exemplo passa nos dois validadores', () => {
    expect(jsonSchema.examples.length).toBeGreaterThan(0);
    for (const ex of jsonSchema.examples) {
      expect(both(ex)).toEqual({ jsonSchema: true, zod: true });
    }
  });

  it('consumidor tolera campos desconhecidos (evolução aditiva)', () => {
    const extended = { ...example, newField: 1, data: { ...example.data, channel: 'PIX' } };
    expect(both(extended)).toEqual({ jsonSchema: true, zod: true });
    const parsed = TransferCompletedEventV1Schema.parse(extended);
    expect(parsed).not.toHaveProperty('newField');
  });

  it.each([
    ['corpo arbitrário', { foo: 1 }],
    ['eventType errado', { ...example, eventType: 'transfer.created' }],
    ['versão 2', { ...example, eventVersion: 2 }],
    ['sem correlationId', { ...example, correlationId: undefined }],
    ['correlationId com quebra de linha', { ...example, correlationId: 'a\nb' }],
    ['valor zero', { ...example, data: { ...example.data, amountCents: 0 } }],
    ['valor decimal', { ...example, data: { ...example.data, amountCents: 1.5 } }],
    ['valor acima do teto', { ...example, data: { ...example.data, amountCents: 100_000_001 } }],
    ['transferId inválido', { ...example, data: { ...example.data, transferId: 'x' } }],
    ['sem data', { ...example, data: undefined }],
  ])('[PRC-AC-05] rejeita %s nos dois validadores', (_caso, value) => {
    expect(both(value)).toEqual({ jsonSchema: false, zod: false });
  });

  it('nunca carrega CPF nem nome (SEC-21)', () => {
    const serialized = JSON.stringify(jsonSchema);
    expect(serialized).not.toMatch(/"(document|holderName|cpf)"/i);
  });
});
