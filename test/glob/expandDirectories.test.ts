import { vol } from 'memfs'
import { globCheckingAgainstReference, makeFiles } from './glob-test-utils.js'

jest.mock('../../src/fs.js', () => {
  return require('memfs')
})

beforeEach(() => {
  vol.reset()
})

test('the "expandDirectories" option', () => {
  const paths = ['/src/stick.txt', '/src/banana/stick.txt', '/sugar.log', '/berthold']
  makeFiles(paths)
  const expanded = globCheckingAgainstReference(paths, ['s*'], {
    cwd: '/',
    expandDirectories: true,
    dot: false,
    types: 'files',
    symbolicLinks: 'follow',
  })

  expect(expanded).toEqual(['/src/banana/stick.txt', '/src/stick.txt', '/sugar.log'])

  const notExpanded = globCheckingAgainstReference(paths, ['s*'], {
    cwd: '/',
    expandDirectories: false,
    dot: false,
    types: 'files',
    symbolicLinks: 'follow',
  })

  expect(notExpanded).toEqual(['/sugar.log'])
})
