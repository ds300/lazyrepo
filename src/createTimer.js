import { isTest } from './isTest.js'
import { duration } from './logger/formatting.js'

const TEST_DURATION = 1000

export function createTimer() {
  let start = new Date().getTime()
  const getElapsedMs = () => (isTest ? TEST_DURATION : new Date().getTime() - start)
  return {
    getElapsedMs,
    formatElapsedTime: () => duration(getElapsedMs()),
    reset: () => {
      start = new Date().getTime()
    },
    getStartTime: () => start,
  }
}
