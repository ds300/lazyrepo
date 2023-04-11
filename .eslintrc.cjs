module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
    'jest/globals': true,
  },
  extends: ['eslint:recommended', 'plugin:n/recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  overrides: [],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-extra-semi': 'off',
    eqeqeq: ['error', 'always'],

    'n/no-process-exit': 'off',

    '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
  },
}
