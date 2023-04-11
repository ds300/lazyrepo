module.exports = {
  env: {
    es2021: true,
    node: true,
    'jest/globals': true,
  },
  extends: ['eslint:recommended', 'plugin:n/recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['jest', '@typescript-eslint'],
  overrides: [],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'n/no-missing-import': 'off',
    'no-extra-semi': 'off',
    eqeqeq: ['error', 'always'],
    'n/no-process-exit': 'off',
  },
}
