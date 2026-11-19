import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import { type Account, CreateAccountRequestSchema, UuidSchema } from '@mini-banco/contracts';
import type { Response } from 'express';
import { parseOrThrow } from '../../../shared/infrastructure/http/validation';
import { CreateAccountUseCase } from '../application/create-account.use-case';
import { GetAccountUseCase } from '../application/get-account.use-case';

@Controller('v1/accounts')
export class AccountsController {
  constructor(
    @Inject(CreateAccountUseCase) private readonly createAccount: CreateAccountUseCase,
    @Inject(GetAccountUseCase) private readonly getAccount: GetAccountUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<Account> {
    const command = parseOrThrow(CreateAccountRequestSchema, body, {
      fieldCode: { field: 'document', code: 'INVALID_DOCUMENT' },
    });
    const account = await this.createAccount.execute(command);
    res.setHeader('location', `/v1/accounts/${account.id}`);
    return account;
  }

  @Get(':accountId')
  get(@Param('accountId') accountId: string): Promise<Account> {
    return this.getAccount.execute(
      parseOrThrow(UuidSchema, accountId, { pathPrefix: 'accountId' }),
    );
  }
}
