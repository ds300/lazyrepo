export default {
  transform: {
    '^.+\\.(j|t)s?$': ['esbuild-jest', { sourcemap: true }],
  },
  transformIgnorePatterns: ['ckafojisfew'],
  modulePathIgnorePatterns: ['<rootDir>/node_modules', '<rootDir>/.test'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
}
