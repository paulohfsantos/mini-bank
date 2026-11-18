// @mini-banco/contracts: contratos compartilhados por api, worker e web.
// Fonte de verdade: specs/openapi.yaml e specs/events/*.schema.json.
export * from './constants';
export * from './cpf';
export * from './schemas/common';
export * from './schemas/accounts';
export * from './schemas/transfers';
export * from './schemas/statement';
export * from './events/transfer-completed';
export type { components, operations, paths } from './generated/openapi';
