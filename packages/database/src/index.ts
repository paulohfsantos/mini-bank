// @mini-banco/database: pool, transações, unidade de trabalho e ids (ADR-0004).
export {
  isUniqueViolation,
  pgErrorCode,
  PgErrorCode,
  ResourceBusyError,
  translatePgError,
} from './errors';
export { createPool, customTypes, type CreatePoolOptions } from './pool';
export { dbTlsOptions, type DbSslMode } from './tls';
export { Database, withTransaction, type TransactionOptions } from './transaction';
export { uuidv7 } from './uuidv7';
export type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
