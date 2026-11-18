/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Mensagens podem citar vários IDs de AC/risco, o que deixa o header longo.
    'header-max-length': [2, 'always', 120],
    'scope-enum': [
      1,
      'always',
      [
        'repo',
        'api',
        'worker',
        'web',
        'contracts',
        'observability',
        'database',
        'config',
        'specs',
        'infra',
        'ci',
        'docs',
        'accounts',
        'transfers',
        'statement',
        'outbox',
        'fraud',
        'notifications',
      ],
    ],
  },
};
