import { rimraf } from 'rimraf'

jest.mock('../src/workspaceRoot.js', () => {
  return {
    workspaceRoot: process.cwd(),
  }
})

beforeAll(() => {
  rimraf.sync('.test')
})
