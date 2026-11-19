// Cursor opaco do extrato (STM-BR-06, ADR-0016, SEC-16): base64url de { t, i }, onde
// t = created_at em microssegundos (string, para não perder precisão) e i = id do lançamento.
// Microssegundos importam: o Postgres guarda timestamptz com essa precisão, e um cursor em
// milissegundos repetiria ou pularia lançamentos do mesmo milissegundo.
import { z } from 'zod';
import { InvalidCursorError } from '../../../shared/domain/errors';
import type { StatementPosition } from './ports';

const CursorPayloadSchema = z.strictObject({
  t: z.string().regex(/^\d{1,19}$/),
  i: z.uuid(),
});

export function encodeCursor(position: StatementPosition): string {
  const payload = { t: position.createdAtMicros.toString(), i: position.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Validação estrita; qualquer desvio vira InvalidCursorError (400 INVALID_CURSOR). */
export function decodeCursor(cursor: string): StatementPosition {
  // O decoder do Node ignora caracteres inválidos em silêncio; a volta exata garante
  // que o texto era base64url canônico.
  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.length === 0 || bytes.toString('base64url') !== cursor) throw new InvalidCursorError();

  let json: unknown;
  try {
    json = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  const parsed = CursorPayloadSchema.safeParse(json);
  if (!parsed.success) throw new InvalidCursorError();
  return { createdAtMicros: BigInt(parsed.data.t), id: parsed.data.i };
}
