export default {
  transform: {
    '^.+\\.(j|t)s?$': ['esbuild-jest', { sourcemap: true }],
  },
  transformIgnorePatterns: ['ckafojisfew'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
}
