/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:n/recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
  ],
  parser: '@typescript-eslint/parser',
  overrides: [
    {
      files: ['**/*'],
      rules: {
        'no-restricted-imports': [
          'error',
          'path',

          {
            name: 'process',
            importNames: ['cwd'],
            message: "Please import 'cwd' from './src/cwd.js' instead.",
          },
        ],
        'no-restricted-properties': [
          2,
          {
            object: 'process',
            property: 'cwd',
          },
        ],
      },
    },
    {
      files: ['src/**', 'bin.js', 'index.js', 'index.d.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          'fs',
          'path',
          'fs/promises',
          'node:fs',
          'node:fs/promises',
        ],
        'no-console': 'error',
        '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        'n/shebang': 'off',
      },
    },
    {
      files: ['test/**'],
      env: {
        'jest/globals': true,
      },
      plugins: ['jest'],
      extends: ['plugin:jest/recommended'],
      rules: {
        'no-restricted-imports': ['error', 'path'],
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-extra-semi': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/restrict-template-expressions': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/restrict-plus-operands': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
      },
    },
    {
      files: ['scripts/**'],
      rules: {
        'n/no-process-exit': 'off',
      },
    },
  ],
  reportUnusedDisableDirectives: true,
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: true,
  },
  rules: {
    '@typescript-eslint/restrict-template-expressions': 'off',
    'n/no-missing-import': 'off',
    'n/no-missing-require': 'off',
    'n/no-unpublished-import': 'off',
    'n/no-unpublished-require': 'off',
    '@typescript-eslint/no-extra-semi': 'off',
    'no-extra-semi': 'off',
    eqeqeq: ['error', 'always'],
  },
}
