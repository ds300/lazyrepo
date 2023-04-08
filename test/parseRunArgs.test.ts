import { describe, expect, it } from 'vitest'
import { parseRunArgs } from '../src/commands/run.js'
import { CLITaskDescription } from '../src/types.js'

function test(args: string[], expected: CLITaskDescription[]) {
  expect(parseRunArgs(args)).toEqual(expected)
}
describe('parseRunArgs', () => {
  it('parses a single task', () => {
    test(['build'], [{ extraArgs: [], filterPaths: [], taskName: 'build' }])
    test(['test'], [{ extraArgs: [], filterPaths: [], taskName: 'test' }])
    test(['fetch-assets'], [{ extraArgs: [], filterPaths: [], taskName: 'fetch-assets' }])
  })

  it('parses a single task with args', () => {
    test(['build', '--watch'], [{ extraArgs: ['--watch'], filterPaths: [], taskName: 'build' }])
    test(
      ['test', '--concurrency=3'],
      [{ extraArgs: ['--concurrency=3'], filterPaths: [], taskName: 'test' }],
    )
    test(
      ['fetch-assets', '--url', 'https://banana.com'],
      [{ extraArgs: ['--url', 'https://banana.com'], filterPaths: [], taskName: 'fetch-assets' }],
    )
  })

  it('parses a :run task with paths', () => {
    test([':run', 'build', 'src'], [{ extraArgs: [], filterPaths: ['src'], taskName: 'build' }])
    test([':run', 'test', 'src'], [{ extraArgs: [], filterPaths: ['src'], taskName: 'test' }])
    test(
      [':run', 'fetch-assets', 'src'],
      [{ extraArgs: [], filterPaths: ['src'], taskName: 'fetch-assets' }],
    )
  })

  it('parses a :run task with paths and args', () => {
    test(
      [':run', 'build', 'src', 'test', '--', '--watch'],
      [{ extraArgs: ['--watch'], filterPaths: ['src', 'test'], taskName: 'build' }],
    )

    test(
      [':run', 'test', 'src', 'test', '--', '--concurrency=3'],
      [{ extraArgs: ['--concurrency=3'], filterPaths: ['src', 'test'], taskName: 'test' }],
    )

    test(
      [':run', 'fetch-assets', 'src', 'test', '--', '--url', 'https://banana.com'],
      [
        {
          extraArgs: ['--url', 'https://banana.com'],
          filterPaths: ['src', 'test'],
          taskName: 'fetch-assets',
        },
      ],
    )
  })

  it('parses multiple :run tasks', () => {
    test(
      [
        ':run',
        'build',
        'src',
        'test',
        '--',
        '--watch',
        ':run',
        'test',
        'src',
        '--',
        '--concurrency=3',
      ],
      [
        { extraArgs: ['--watch'], filterPaths: ['src', 'test'], taskName: 'build' },
        { extraArgs: ['--concurrency=3'], filterPaths: ['src'], taskName: 'test' },
      ],
    )

    test(
      [
        ':run',
        'build',
        'src',
        'test',
        '--',
        '--watch',
        ':run',
        'test',
        'src',
        '--',
        '--concurrency=3',
        ':run',
        'fetch-assets',
        'packages/banana',
        'packages/apple',
        'packages/friend',
        '--',
        '--concurrency=3',
        '--runInBand',
      ],
      [
        { extraArgs: ['--watch'], filterPaths: ['src', 'test'], taskName: 'build' },
        { extraArgs: ['--concurrency=3'], filterPaths: ['src'], taskName: 'test' },
        {
          extraArgs: ['--concurrency=3', '--runInBand'],
          filterPaths: ['packages/banana', 'packages/apple', 'packages/friend'],
          taskName: 'fetch-assets',
        },
      ],
    )
  })
})
