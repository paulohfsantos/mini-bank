// Middleware HTTP (node:http, compatível com Express/Nest): resolve o correlationId,
// devolve-o no header de resposta, abre o contexto e escreve UMA linha ao final
// da requisição (PERF-24). Nunca loga body, query string nem headers.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HEADERS } from '@mini-banco/contracts';
import { resolveCorrelationId, runWithCorrelationId } from './correlation';
import type { Logger } from './logger';

export type NextFunction = (error?: unknown) => void;

export function createHttpLogger(logger: Logger) {
  return (req: IncomingMessage, res: ServerResponse, next: NextFunction): void => {
    const correlationId = resolveCorrelationId(req.headers[HEADERS.correlationId]);
    res.setHeader(HEADERS.correlationId, correlationId);
    const startedAt = process.hrtime.bigint();
    let logged = false;

    const log = (aborted: boolean) => {
      if (logged) return;
      logged = true;
      const status = res.statusCode;
      const fields = {
        correlationId,
        method: req.method,
        path: (req.url ?? '/').split('?')[0],
        status,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        ...(aborted ? { aborted: true } : {}),
      };
      if (status >= 500) logger.error(fields, 'request completed');
      else if (status >= 400 || aborted) logger.warn(fields, 'request completed');
      else logger.info(fields, 'request completed');
    };

    res.once('finish', () => log(false));
    // 'close' sem 'finish' = cliente desconectou antes da resposta terminar.
    res.once('close', () => log(!res.writableFinished));

    runWithCorrelationId(correlationId, () => next());
  };
}
