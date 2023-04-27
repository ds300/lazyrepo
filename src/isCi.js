import { isCI } from 'ci-info'
import { isTest } from './isTest.js'

export const isCi = isCI || (isTest && process.env.__test__FORCE_CI)
