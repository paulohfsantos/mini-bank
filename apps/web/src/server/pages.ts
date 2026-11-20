// Apoio às páginas de leitura: 404 para id inválido ou inexistente (WEB-BR-08) e
// falha conhecida da API como painel inline (com correlationId) em vez do error.tsx.
import 'server-only';
import { UuidSchema } from '@mini-banco/contracts';
import { notFound } from 'next/navigation';
import { ApiFailure } from '../lib/api-client';
import { describeFailure, type FailureView } from '../lib/error-messages';

export function requireUuid(value: string): string {
  if (!UuidSchema.safeParse(value).success) notFound();
  return value;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; view: FailureView };

export async function load<T>(promise: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await promise };
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    const { failure } = error;
    if (
      failure.kind === 'problem' &&
      ['ACCOUNT_NOT_FOUND', 'TRANSFER_NOT_FOUND'].includes(failure.problem.code)
    ) {
      notFound();
    }
    return { ok: false, view: describeFailure(failure) };
  }
}
