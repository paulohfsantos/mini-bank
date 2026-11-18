// Jest único na raiz, com @swc/jest para transpilar TypeScript rápido.
// O typecheck é feito à parte (`pnpm typecheck`), então o swc só remove tipos.
/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/apps', '<rootDir>/packages'],
  testMatch: ['**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.next/'],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          target: 'es2024',
          parser: { syntax: 'typescript', decorators: true },
          // NestJS precisa de decorators legados + metadata para injeção de dependência.
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
        module: { type: 'commonjs' },
      },
    ],
  },
};
