import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import {
  CreateTransferRequestSchema,
  HEADERS,
  IdempotencyKeySchema,
  type Transfer,
  UuidSchema,
} from '@mini-banco/contracts';
import { getCorrelationId } from '@mini-banco/observability';
import type { Response } from 'express';
import { ClientId } from '../../../shared/infrastructure/http/decorators';
import { HttpProblem } from '../../../shared/infrastructure/http/problem';
import { parseOrThrow } from '../../../shared/infrastructure/http/validation';
import { GetTransferUseCase } from '../application/get-transfer.use-case';
import { TransferFundsUseCase } from '../application/transfer-funds.use-case';

@Controller('v1/transfers')
export class TransfersController {
  constructor(
    @Inject(TransferFundsUseCase) private readonly transferFunds: TransferFundsUseCase,
    @Inject(GetTransferUseCase) private readonly getTransfer: GetTransferUseCase,
  ) {}

  /**
   * TRF-BR-13: a autenticação (1) já passou no middleware. Aqui, em ordem explícita:
   * (2) Idempotency-Key → (3) schema do corpo → use case (4–7).
   */
  @Post()
  async create(
    @ClientId() clientId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Transfer> {
    const key = headers[HEADERS.idempotencyKey];
    if (key === undefined) {
      throw new HttpProblem(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Envie o header Idempotency-Key (UUID recomendado)',
      );
    }
    if (typeof key !== 'string' || !IdempotencyKeySchema.safeParse(key).success) {
      throw new HttpProblem(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key deve ter 1 a 64 caracteres [A-Za-z0-9_-]',
      );
    }
    const request = parseOrThrow(CreateTransferRequestSchema, body);

    const result = await this.transferFunds.execute({
      ...request,
      clientId,
      idempotencyKey: key,
      // O middleware sempre abre o contexto; o fallback só existiria por bug de wiring.
      correlationId: getCorrelationId() ?? 'missing-correlation-id',
    });

    res.status(result.status);
    res.setHeader('location', `/v1/transfers/${result.body.id}`);
    if (result.replayed) res.setHeader(HEADERS.idempotentReplayed, 'true');
    return result.body;
  }

  @Get(':transferId')
  get(@Param('transferId') transferId: string): Promise<Transfer> {
    return this.getTransfer.execute(
      parseOrThrow(UuidSchema, transferId, { pathPrefix: 'transferId' }),
    );
  }
}
