import { isCI } from 'ci-info'

export const isCi = process.env.__test__FORCE_CI ? process.env.__test__FORCE_CI === 'true' : isCI
