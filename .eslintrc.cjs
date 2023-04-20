module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
  },
  extends: ['eslint:recommended', 'plugin:n/recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  overrides: [
    {
      files: ['*.ts', '*.js'],
      extends: [
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
      ],
      parserOptions: {
        project: ['./tsconfig.json'],
      },
    },
    {
      files: ['{test,scripts}/**'],
      env: {
        'jest/globals': true,
      },
      plugins: ['jest'],
      extends: ['plugin:jest/recommended'],
      rules: {
        'no-restricted-imports': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-extra-semi': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/restrict-template-expressions': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-restricted-imports': ['error', 'fs', 'fs/promises', 'node:fs', 'node:fs/promises'],
    'no-console': 'error',
    'no-extra-semi': 'off',
    eqeqeq: ['error', 'always'],

    'n/no-process-exit': 'off',
    'n/no-missing-import': 'off',
    'n/no-missing-require': 'off',
    'n/no-unpublished-import': 'off',
    'n/no-unpublished-require': 'off',

    '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-extra-semi': 'off',
    '@typescript-eslint/restrict-template-expressions': 'off',
  },
}
