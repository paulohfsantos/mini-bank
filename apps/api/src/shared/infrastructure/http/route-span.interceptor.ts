import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { renameActiveSpan, setActiveSpanAttributes } from '@mini-banco/observability';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

/**
 * Dá ao span de servidor do http o nome da rota (`POST /v1/transfers`) e o atributo
 * `http.route`, com o padrão da rota (`/v1/transfers/:transferId`), nunca a URL com ids
 * (OBS-BR-08). Substitui a instrumentação do Nest, que ainda não suporta o Nest 12.
 */
export class RouteSpanInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<Request>();
      const route = (req.route as { path?: unknown } | undefined)?.path;
      if (typeof route === 'string') {
        renameActiveSpan(`${req.method} ${route}`);
        setActiveSpanAttributes({ 'http.route': route });
      }
    }
    return next.handle();
  }
}
