import { createHash } from 'node:crypto';
import type { CreateTransferRequest } from '@mini-banco/contracts';

/**
 * TRF-BR-09: SHA-256 do payload canônico. Usa o payload já validado, com as chaves em
 * ordem fixa, então espaços, ordem das chaves no JSON recebido ou campos ignorados não
 * mudam o hash.
 */
export function hashTransferRequest(request: CreateTransferRequest): string {
  const canonical = JSON.stringify([
    ['amountCents', request.amountCents],
    ['destinationAccountId', request.destinationAccountId],
    ['sourceAccountId', request.sourceAccountId],
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
