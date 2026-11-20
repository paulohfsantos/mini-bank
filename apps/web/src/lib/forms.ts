// Estado dos formulários, compartilhado entre Server Actions e Client Components.

export interface FormState<F extends string> {
  /** Erro geral (acima do formulário). */
  message?: string;
  /** Só nas falhas genéricas (WEB-BR-05/06). */
  correlationId?: string;
  fieldErrors: Partial<Record<F, string>>;
  /** O que foi digitado, para repovoar o formulário depois de um erro. */
  values: Partial<Record<F, string>>;
}

export function emptyState<F extends string>(
  values: Partial<Record<F, string>> = {},
): FormState<F> {
  return { fieldErrors: {}, values };
}

export const MALFORMED_REQUEST = 'Requisição inválida. Recarregue a página e tente de novo.';

const MAX_FIELD_LENGTH = 256;

/**
 * Lê só os campos esperados (WEB-BR-02 / SEC-24). Campo extra, repetido, arquivo, longo
 * demais ou ausente marca a requisição como malformada: a action é um endpoint público e
 * pode receber qualquer coisa. Campos `$ACTION_*` são do próprio React (envio sem JS).
 */
export function readForm<F extends string>(
  formData: FormData,
  fields: readonly F[],
): { values: Record<F, string>; malformed: boolean } {
  const allowed = new Set<string>(fields);
  const values = Object.fromEntries(fields.map((f) => [f, ''])) as Record<F, string>;
  const seen = new Set<string>();
  let malformed = false;

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('$ACTION')) continue;
    if (
      !allowed.has(key) ||
      seen.has(key) ||
      typeof value !== 'string' ||
      value.length > MAX_FIELD_LENGTH
    ) {
      malformed = true;
      continue;
    }
    seen.add(key);
    values[key as F] = value;
  }
  if (seen.size !== allowed.size) malformed = true;
  return { values, malformed };
}
