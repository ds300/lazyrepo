export default {
  transform: {
    '^.+\\.(j|t)s?$': '@swc/jest',
  },
  transformIgnorePatterns: ['ckafojisfew'],
  modulePathIgnorePatterns: ['<rootDir>/node_modules', '<rootDir>/.test'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
}
