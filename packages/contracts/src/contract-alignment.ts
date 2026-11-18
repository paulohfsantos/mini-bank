// Verificação em tempo de compilação: os tipos inferidos dos schemas zod precisam
// coincidir com os tipos gerados do openapi.yaml (src/generated/openapi.ts).
// Se alguém mudar o contrato sem ajustar o zod (ou vice-versa), `pnpm typecheck` falha.
// Este arquivo não exporta nada em runtime.
import type { z } from 'zod';
import type { components } from './generated/openapi';
import type { AccountSchema, CreateAccountRequestSchema } from './schemas/accounts';
import type { HealthSchema, ProblemSchema } from './schemas/common';
import type { StatementEntrySchema, StatementPageSchema } from './schemas/statement';
import type { CreateTransferRequestSchema, TransferSchema } from './schemas/transfers';

type Schemas = components['schemas'];

/** Igualdade estrutural nos dois sentidos (A atribuível a B e B atribuível a A). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

// Requisições: compara o formato de entrada (o que trafega no fio).
export type _CreateAccountRequest = Assert<
  Same<z.input<typeof CreateAccountRequestSchema>, Schemas['CreateAccountRequest']>
>;
export type _CreateTransferRequest = Assert<
  Same<z.input<typeof CreateTransferRequestSchema>, Schemas['CreateTransferRequest']>
>;

// Respostas: compara o formato de saída.
export type _Account = Assert<Same<z.output<typeof AccountSchema>, Schemas['Account']>>;
export type _Transfer = Assert<Same<z.output<typeof TransferSchema>, Schemas['Transfer']>>;
export type _StatementEntry = Assert<
  Same<z.output<typeof StatementEntrySchema>, Schemas['StatementEntry']>
>;
export type _StatementPage = Assert<
  Same<z.output<typeof StatementPageSchema>, Schemas['StatementPage']>
>;
export type _Problem = Assert<Same<z.output<typeof ProblemSchema>, Schemas['Problem']>>;
export type _Health = Assert<Same<z.output<typeof HealthSchema>, Schemas['Health']>>;
