import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { type StatementPage, StatementQuerySchema, UuidSchema } from '@mini-banco/contracts';
import { parseOrThrow } from '../../../shared/infrastructure/http/validation';
import { GetStatementUseCase } from '../application/get-statement.use-case';

@Controller('v1/accounts/:accountId/statement')
export class StatementController {
  constructor(@Inject(GetStatementUseCase) private readonly getStatement: GetStatementUseCase) {}

  @Get()
  get(@Param('accountId') accountId: string, @Query() query: unknown): Promise<StatementPage> {
    const id = parseOrThrow(UuidSchema, accountId, { pathPrefix: 'accountId' });
    // Cursor fora do formato (caracteres, tamanho) → INVALID_CURSOR, como o conteúdo (STM-AC-03).
    const { limit, cursor } = parseOrThrow(StatementQuerySchema, query, {
      fieldCode: { field: 'cursor', code: 'INVALID_CURSOR' },
    });
    return this.getStatement.execute({ accountId: id, limit, ...(cursor ? { cursor } : {}) });
  }
}
