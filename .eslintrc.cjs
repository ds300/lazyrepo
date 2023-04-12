module.exports = {
  root: true,
  env: {
    es2021: true,
    node: true,
    'jest/globals': true,
  },
  extends: ['eslint:recommended', 'plugin:n/recommended'],
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
      files: ['test/**'],
      plugins: ['jest'],
      extends: ['plugin:jest/recommended'],
      rules: {},
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    'no-extra-semi': 'off',
    eqeqeq: ['error', 'always'],

    'n/no-process-exit': 'off',
    'n/no-missing-import': 'off',
    'n/no-missing-require': 'off',

    '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
  },
}
