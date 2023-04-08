import { vitest } from 'vitest'

vitest.mock('../src/workspaceRoot.js', () => {
  return {
    workspaceRoot: process.cwd(),
  }
})
