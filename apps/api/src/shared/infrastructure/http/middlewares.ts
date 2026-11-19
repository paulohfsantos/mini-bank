// Middlewares Express que rodam ANTES do roteamento do Nest, na ordem de TRF-BR-13:
// correlação/log → autenticação → corpo (limite de tamanho, JSON) → rota.
// A autenticação vem antes do roteamento: rota inexistente sem chave responde 401,
// sem revelar quais rotas existem (specs/README, erros transversais).
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HEADERS } from '@mini-banco/contracts';
import type { NextFunction } from '@mini-banco/observability';
import express from 'express';
import type { ApiKeyEntry } from '../../../config';
import { buildProblem, sendProblem } from './problem';

export interface AuthenticatedRequest extends IncomingMessage {
  clientId?: string;
}

const PUBLIC_PATHS = [/^\/health\/(live|ready)$/, /^\/docs(\/.*)?$/];

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * ADR-0012 / SEC-08: compara hashes SHA-256 com timingSafeEqual. Hash primeiro porque
 * timingSafeEqual exige o mesmo tamanho e comparar tamanhos vazaria o comprimento da chave.
 * Percorre todas as chaves sem sair cedo.
 */
export function createApiKeyAuth(keys: readonly ApiKeyEntry[]) {
  const entries = keys.map((k) => ({ clientId: k.clientId, hash: sha256(k.key) }));
  return (req: AuthenticatedRequest, res: ServerResponse, next: NextFunction): void => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (PUBLIC_PATHS.some((p) => p.test(path))) return next();

    const provided = req.headers[HEADERS.apiKey];
    let clientId: string | undefined;
    if (typeof provided === 'string' && provided.length > 0 && provided.length <= 256) {
      const hash = sha256(provided);
      for (const entry of entries) {
        if (timingSafeEqual(hash, entry.hash)) clientId = entry.clientId;
      }
    }
    if (!clientId)
      return sendProblem(res, buildProblem('UNAUTHORIZED', 'x-api-key ausente ou inválida'));
    req.clientId = clientId;
    next();
  };
}

/** Limite do corpo (ACC-AC-08, PERF/SEC): 16 KB. JSON estrito (só objeto/array no topo). */
export const BODY_LIMIT = '16kb';

/**
 * express.json com os erros convertidos em problem+json aqui mesmo: eles acontecem antes
 * do Nest, onde o filtro global não alcança.
 */
export function createJsonBodyParser() {
  const parse = express.json({ limit: BODY_LIMIT, strict: true });
  return (req: IncomingMessage, res: ServerResponse, next: NextFunction): void => {
    parse(req, res, (error?: unknown) => {
      if (!error) return next();
      const type = (error as { type?: unknown }).type;
      if (type === 'entity.too.large') {
        return sendProblem(res, buildProblem('PAYLOAD_TOO_LARGE', `O corpo excede ${BODY_LIMIT}`));
      }
      return sendProblem(res, buildProblem('VALIDATION_ERROR', 'Corpo não é um JSON válido'));
    });
  };
}
