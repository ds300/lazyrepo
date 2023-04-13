module.exports = {
  env: {
    es2021: true,
    node: true,
    'jest/globals': true,
  },
  extends: ['eslint:recommended', 'plugin:n/recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['jest', '@typescript-eslint'],
  overrides: [],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-extra-semi': 'off',
    'n/no-missing-import': 'off',
    'n/no-process-exit': 'off',
    'n/no-unpublished-import': 'off',
    'n/no-unpublished-require': 'off',
    'no-console': 'error',
    'no-extra-semi': 'off',
    eqeqeq: ['error', 'always'],
  },
}
