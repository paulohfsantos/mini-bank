// Validação na borda com os schemas zod de @mini-banco/contracts (ADR-0005).
import type { ErrorCode } from '@mini-banco/contracts';
import type { z } from 'zod';
import { type FieldError, HttpProblem } from './problem';

type ValidationCode = 'VALIDATION_ERROR' | 'INVALID_DOCUMENT' | 'INVALID_CURSOR';

export interface ParseOptions {
  /**
   * Se TODAS as falhas forem neste campo, usa o code específico (ex.: só o CPF errado →
   * INVALID_DOCUMENT). Falhas em vários campos ficam como VALIDATION_ERROR com errors[].
   */
  fieldCode?: { field: string; code: Extract<ErrorCode, ValidationCode> };
  /** Prefixo do path nos errors[] (ex.: "accountId" para um parâmetro de rota). */
  pathPrefix?: string;
}

export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  options: ParseOptions = {},
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const errors: FieldError[] = result.error.issues.map((issue) => ({
    path: [options.pathPrefix, ...issue.path.map(String)].filter(Boolean).join('.') || '(body)',
    message: issue.message,
  }));
  const { fieldCode } = options;
  if (fieldCode && errors.every((e) => e.path === fieldCode.field)) {
    throw new HttpProblem(fieldCode.code, errors[0]?.message);
  }
  throw new HttpProblem('VALIDATION_ERROR', 'Um ou mais campos são inválidos', errors);
}
