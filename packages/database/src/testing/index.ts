import './provided-context';
// @mini-banco/database/testing: só para testes (depende de Testcontainers).
export { createTestDatabase, startTestPostgres, type TestDatabase } from './postgres';
