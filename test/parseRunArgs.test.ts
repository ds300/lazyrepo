import { parseRunArgs } from '../src/commands/run.js'
// eslint-disable-next-line n/no-missing-import
import { CLITaskDescription } from '../src/types.js'

function test(args: string[], expected: CLITaskDescription[]) {
  expect(parseRunArgs(args)).toEqual(expected)
}
describe('parseRunArgs', () => {
  it('parses a single task', () => {
    test(['build'], [{ extraArgs: [], filterPaths: [], taskName: 'build', force: false }])
    test(['test'], [{ extraArgs: [], filterPaths: [], taskName: 'test', force: false }])
    test(
      ['fetch-assets'],
      [{ extraArgs: [], filterPaths: [], taskName: 'fetch-assets', force: false }],
    )
  })

  it('parses a single task with args', () => {
    test(
      ['build', '--watch'],
      [{ extraArgs: ['--watch'], filterPaths: [], taskName: 'build', force: false }],
    )
    test(
      ['test', '--concurrency=3'],
      [{ extraArgs: ['--concurrency=3'], filterPaths: [], taskName: 'test', force: false }],
    )
    test(
      ['fetch-assets', '--url', 'https://banana.com'],
      [
        {
          extraArgs: ['--url', 'https://banana.com'],
          filterPaths: [],
          taskName: 'fetch-assets',
          force: false,
        },
      ],
    )

    test(
      ['build', '--force'],
      [{ extraArgs: ['--force'], filterPaths: [], taskName: 'build', force: false }],
    )
  })

  it('parses a :run task with paths', () => {
    test(
      [':run', 'build', 'src'],
      [{ extraArgs: [], filterPaths: ['src'], taskName: 'build', force: false }],
    )
    test(
      [':run', 'test', 'src'],
      [{ extraArgs: [], filterPaths: ['src'], taskName: 'test', force: false }],
    )
    test(
      [':run', 'fetch-assets', 'src'],
      [{ extraArgs: [], filterPaths: ['src'], taskName: 'fetch-assets', force: false }],
    )

    test(
      [':force', 'build', 'src'],
      [{ extraArgs: [], filterPaths: ['src'], taskName: 'build', force: true }],
    )
  })

  it('parses a :run task with paths and args', () => {
    test(
      [':run', 'build', 'src', 'test', '--', '--watch'],
      [{ extraArgs: ['--watch'], filterPaths: ['src', 'test'], taskName: 'build', force: false }],
    )

    test(
      [':run', 'test', 'src', 'test', '--', '--concurrency=3'],
      [
        {
          extraArgs: ['--concurrency=3'],
          filterPaths: ['src', 'test'],
          taskName: 'test',
          force: false,
        },
      ],
    )

    test(
      [':run', 'fetch-assets', 'src', 'test', '--', '--url', 'https://banana.com'],
      [
        {
          extraArgs: ['--url', 'https://banana.com'],
          filterPaths: ['src', 'test'],
          taskName: 'fetch-assets',
          force: false,
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
        { extraArgs: ['--watch'], filterPaths: ['src', 'test'], taskName: 'build', force: false },
        { extraArgs: ['--concurrency=3'], filterPaths: ['src'], taskName: 'test', force: false },
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
        { extraArgs: ['--watch'], filterPaths: ['src', 'test'], taskName: 'build', force: false },
        { extraArgs: ['--concurrency=3'], filterPaths: ['src'], taskName: 'test', force: false },
        {
          extraArgs: ['--concurrency=3', '--runInBand'],
          filterPaths: ['packages/banana', 'packages/apple', 'packages/friend'],
          taskName: 'fetch-assets',
          force: false,
        },
      ],
    )
  })
})
