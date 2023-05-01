import { isCI } from 'ci-info'

export const isCi = process.env.__test__IS_CI_OVERRIDE
  ? process.env.__test__IS_CI_OVERRIDE === 'true'
  : isCI
