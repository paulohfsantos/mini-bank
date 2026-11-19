import { createResponseValidator } from '@mini-banco/contracts/testing';
import type { Response } from 'supertest';
import { expect } from 'vitest';

const validate = createResponseValidator();

interface StatementItemBody {
  id: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  transferId: string | null;
  counterpartyAccountId: string | null;
}

/** Visão tipada (e frouxa) dos corpos que os testes inspecionam; o contrato já valida a forma. */
export interface TestBody {
  id: string;
  code: string;
  detail: string;
  errors: { path: string; message: string }[];
  holderName: string;
  balanceCents: number;
  documentMasked: string;
  items: StatementItemBody[];
  nextCursor: string | null;
}

export function bodyOf(res: Response): TestBody {
  return res.body as TestBody;
}

/** Toda resposta e2e é conferida contra o openapi.yaml (status, content-type e corpo). */
export function expectContract(res: Response, method: string, path: string): void {
  const problems = validate({
    method,
    path,
    status: res.status,
    contentType: res.headers['content-type'],
    body: res.body,
  });
  expect(problems, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`).toEqual([]);
}
