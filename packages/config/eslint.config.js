// Configuração ESLint compartilhada (flat config).
// Regras com informação de tipo ligadas: no-floating-promises e no-misused-promises
// pegam bugs reais em código assíncrono (transações, SQS, handlers).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    '**/.terraform/**',
    '**/src/generated/**',
    // Gerados pelo Next e pelo Playwright.
    '**/next-env.d.ts',
    '**/test-results/**',
    '**/playwright-report/**',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // SEC-09: SQL só parametrizado. Bloqueia template string com interpolação e
      // concatenação como primeiro argumento de query(). Identificadores dinâmicos
      // (raros) vão numa variável montada com whitelist/escapeIdentifier e comentário.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='query'] > TemplateLiteral.arguments:first-child[expressions.length>0]",
          message:
            'SQL com interpolação: use parâmetros ($1, $2) e passe os valores no array (SEC-09).',
        },
        {
          selector:
            "CallExpression[callee.property.name='query'] > BinaryExpression.arguments:first-child[operator='+']",
          message: 'SQL concatenado: use parâmetros ($1, $2) e passe os valores no array (SEC-09).',
        },
      ],
      // Imports relativos sem extensão: o typecheck usa moduleResolution bundler e o build
      // (SWC, resolveFully) acrescenta `.js` na saída ESM. ADR-0023.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.{1,2}/.*\\.js$',
              message: 'Import relativo sem extensão (convenção do projeto).',
            },
          ],
        },
      ],
    },
  },

  // Arquivos JS de configuração não fazem parte de nenhum tsconfig.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Scripts de linha de comando escrevem no terminal por definição.
  {
    files: ['scripts/**/*.{js,mjs}'],
    rules: { 'no-console': 'off' },
  },

  // Testes podem usar asserções mais soltas.
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Sempre por último: desliga regras que conflitam com o Prettier.
  prettier,
);
