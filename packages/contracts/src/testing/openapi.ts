// Utilitários de teste: carregam specs/openapi.yaml, extraem exemplos e compilam
// os schemas do contrato com ajv (OpenAPI 3.1 = JSON Schema 2020-12).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

export const SPECS_DIR = resolve(import.meta.dirname, '../../../../specs');

interface Ref {
  $ref: string;
}
interface MediaType {
  schema?: Ref;
  examples?: Record<string, { value?: unknown } | Ref>;
}
interface Response {
  content?: Record<string, MediaType>;
}
interface Operation {
  operationId: string;
  requestBody?: { content: Record<string, MediaType> };
  responses: Record<string, Response | Ref>;
}
export interface OpenApiDoc {
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, unknown>;
    responses: Record<string, Response>;
    examples: Record<string, { value: unknown }>;
  };
}

export function loadOpenApi(): OpenApiDoc {
  return parse(readFileSync(resolve(SPECS_DIR, 'openapi.yaml'), 'utf8')) as OpenApiDoc;
}

function isRef(value: unknown): value is Ref {
  return typeof value === 'object' && value !== null && '$ref' in value;
}

function refName(ref: string, prefix: string): string {
  if (!ref.startsWith(prefix)) throw new Error(`$ref inesperado: ${ref}`);
  return ref.slice(prefix.length);
}

export interface ContractExample {
  /** Ex.: "createAccount 201 created" */
  label: string;
  /** Nome do schema em components.schemas. */
  schema: string;
  value: unknown;
}

/** Todos os exemplos de request e response do contrato, com o schema a que pertencem. */
export function collectExamples(doc: OpenApiDoc): ContractExample[] {
  const out: ContractExample[] = [];

  const fromMedia = (label: string, media: MediaType | undefined) => {
    if (!media?.schema || !media.examples) return;
    const schema = refName(media.schema.$ref, '#/components/schemas/');
    for (const [name, example] of Object.entries(media.examples)) {
      const value = isRef(example)
        ? doc.components.examples[refName(example.$ref, '#/components/examples/')]?.value
        : example.value;
      out.push({ label: `${label} ${name}`, schema, value });
    }
  };

  for (const methods of Object.values(doc.paths)) {
    for (const op of Object.values(methods)) {
      for (const [type, media] of Object.entries(op.requestBody?.content ?? {})) {
        fromMedia(`${op.operationId} request ${type}`, media);
      }
      for (const [status, raw] of Object.entries(op.responses)) {
        const response = isRef(raw)
          ? doc.components.responses[refName(raw.$ref, '#/components/responses/')]
          : raw;
        for (const [type, media] of Object.entries(response?.content ?? {})) {
          fromMedia(`${op.operationId} ${status} ${type}`, media);
        }
      }
    }
  }
  return out;
}

const OAS_ID = 'https://mini-banco.dev/openapi';

/** Valida contra components.schemas.<name> exatamente como o contrato descreve. */
export function createOpenApiValidator(doc: OpenApiDoc) {
  // strict: false porque o documento-raiz não é um JSON Schema (tem "components").
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: OAS_ID, components: doc.components });
  return (schemaName: string, value: unknown): boolean => {
    const validate = ajv.getSchema(`${OAS_ID}#/components/schemas/${schemaName}`);
    if (!validate) throw new Error(`schema ${schemaName} não encontrado no contrato`);
    return validate(value) as boolean;
  };
}

/** Remove o prefixo `#/components/<tipo>/` de um $ref. */
function componentName(ref: string, kind: 'schemas' | 'responses'): string {
  return refName(ref, `#/components/${kind}/`);
}

export interface ResponseCheck {
  method: string;
  /** Template do path como no contrato, ex.: `/v1/accounts/{accountId}`. */
  path: string;
  status: number;
  contentType: string | undefined;
  body: unknown;
}

/**
 * Valida uma resposta HTTP real contra o contrato: o status precisa estar documentado
 * para a operação, o content-type precisa bater e o corpo precisa validar no schema.
 * Devolve a lista de problemas (vazia = conforme).
 */
export function createResponseValidator(doc: OpenApiDoc = loadOpenApi()) {
  const validateSchema = createOpenApiValidator(doc);
  return (check: ResponseCheck): string[] => {
    const operation = doc.paths[check.path]?.[check.method.toLowerCase()];
    if (!operation) return [`operação ${check.method} ${check.path} não existe no contrato`];

    const raw = operation.responses[String(check.status)];
    if (!raw) return [`status ${check.status} não documentado em ${operation.operationId}`];
    const response = isRef(raw)
      ? doc.components.responses[componentName(raw.$ref, 'responses')]
      : raw;
    const content = response?.content;
    if (!content)
      return check.body === undefined || check.body === ''
        ? []
        : ['resposta sem corpo no contrato'];

    const mediaType = (check.contentType ?? '').split(';')[0]?.trim() ?? '';
    const media = content[mediaType];
    if (!media?.schema) {
      return [
        `content-type ${mediaType || '(vazio)'} não documentado (esperado: ${Object.keys(content).join(', ')})`,
      ];
    }
    const schema = componentName(media.schema.$ref, 'schemas');
    return validateSchema(schema, check.body) ? [] : [`corpo não valida no schema ${schema}`];
  };
}
