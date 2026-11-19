import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './middlewares';

/** clientId resolvido pelo middleware de API key (escopo da idempotência, TRF-BR-08). */
export const ClientId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const clientId = ctx.switchToHttp().getRequest<AuthenticatedRequest>().clientId;
  // Rotas protegidas só chegam aqui depois do middleware; sem clientId é bug de wiring.
  if (!clientId) throw new Error('clientId ausente: middleware de API key não executou');
  return clientId;
});
