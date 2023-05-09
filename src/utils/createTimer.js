import { duration } from '../logger/formatting.js'
import { isTest } from './isTest.js'

const TEST_DURATION_NS = 1000n * 1000000n

export function createTimer() {
  let start = process.hrtime.bigint()
  const getElapsedNs = () => (isTest ? TEST_DURATION_NS : process.hrtime.bigint() - start)
  const getElapsedMs = () => Number(getElapsedNs() / 1000000n)
  return {
    getElapsedMs,
    getElapsedNs,
    formatElapsedTime: () => duration(getElapsedMs()),
    reset: () => {
      start = process.hrtime.bigint()
    },
    getStartTime: () => start,
  }
}
