import { cwd } from '../../src/cwd.js'
import { join } from '../../src/path.js'
import { findFspyBinary } from '../../src/tracking/findFspyBinary.js'
import { Dir, makeConfigFile, runIntegrationTest } from './runIntegrationTests.js'

const fspyBinary = findFspyBinary()

describe('automatic input tracking', () => {
  const makeDir = (): Dir => ({
    'lazy.config.js': makeConfigFile({
      scripts: {
        build: {
          execution: 'top-level',
          baseCommand: 'cat src/index.js',
          cache: {
            inputs: ['src/**/*'],
          },
        },
      },
    }),
    src: {
      'index.js': 'console.log("hello")',
    },
    'untracked-file.txt': 'this file is not in cache.inputs but will not be read',
  })

  test('tracked reads from run N appear in the manifest on run N+1', { retry: 2 }, async () => {
    await runIntegrationTest(
      {
        packageManager: 'pnpm',
        structure: {
          ...makeDir(),
          'lazy.config.js': makeConfigFile({
            scripts: {
              build: {
                execution: 'top-level',
                baseCommand: 'cat extra.txt',
                cache: {
                  inputs: ['src/**/*'],
                },
              },
            },
          }),
          'extra.txt': 'this file is read but not in inputs',
        },
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const run1 = await t.exec(['build'], {
          env: {
            FSPY_TRACE_BIN: fspyBinary!,
          },
        })
        expect(run1.status).toBe(0)

        const run2 = await t.exec(['build', '--force'], {
          env: {
            FSPY_TRACE_BIN: fspyBinary!,
          },
        })
        expect(run2.status).toBe(0)
        expect(run2.output).toContain('extra.txt')
      },
    )
  })

  test('tracks inputs automatically when fspy binary is available', { retry: 2 }, async () => {
    await runIntegrationTest(
      {
        packageManager: 'pnpm',
        structure: makeDir(),
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const result = await t.exec(['build'], {
          env: {
            FSPY_TRACE_BIN: fspyBinary!,
          },
        })

        expect(result.status).toBe(0)
        expect(result.output).toContain('done')
      },
    )
  })

  test('exits with correct code when task fails', { retry: 2 }, async () => {
    await runIntegrationTest(
      {
        packageManager: 'pnpm',
        structure: {
          'lazy.config.js': makeConfigFile({
            scripts: {
              build: {
                execution: 'top-level',
                baseCommand: 'exit 1',
              },
            },
          }),
        },
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const result = await t.exec(['build'], {
          expectError: true,
          env: {
            FSPY_TRACE_BIN: fspyBinary!,
          },
        })

        expect(result.status).toBe(1)
      },
    )
  })

  test('skips tracking when cache.auto is false', { retry: 2 }, async () => {
    await runIntegrationTest(
      {
        packageManager: 'pnpm',
        structure: {
          'lazy.config.js': makeConfigFile({
            scripts: {
              build: {
                execution: 'top-level',
                baseCommand: 'cat extra.txt',
                cache: {
                  auto: false,
                  inputs: ['src/**/*'],
                },
              },
            },
          }),
          src: {
            'index.js': 'console.log("hello")',
          },
          'extra.txt': 'this file is read but not in inputs',
        },
        workspaceGlobs: ['packages/*'],
      },
      async (t) => {
        const run1 = await t.exec(['build'], {
          env: {
            FSPY_TRACE_BIN: fspyBinary!,
          },
        })
        expect(run1.status).toBe(0)
        expect(run1.output).toContain('done')

        const run2 = await t.exec(['build', '--force'], {
          env: {
            FSPY_TRACE_BIN: fspyBinary!,
          },
        })
        expect(run2.status).toBe(0)
        const manifest = t.read('.lazy/build/manifest.tsv')
        expect(manifest).not.toContain('extra.txt')
      },
    )
  })
})

describe('compareTrackedInputs', () => {
  test('identifies under-specified files', { retry: 2 }, async () => {
    const { compareTrackedInputs } = await import('../../src/tracking/compareTrackedInputs.js')
    const { writeFileSync, mkdirSync } = await import('fs')
    const tmpDir = join(cwd, '.test', `tracking-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })

    const trackingJson = JSON.stringify([
      { path: join(tmpDir, 'src/index.ts'), mode: 'read' },
      { path: join(tmpDir, 'src/utils.ts'), mode: 'read' },
      { path: join(tmpDir, 'config.json'), mode: 'read' },
      { path: '/usr/lib/something', mode: 'read' },
      { path: join(tmpDir, 'dist/out.js'), mode: 'write' },
    ])

    const trackingPath = join(tmpDir, 'tracked.json')
    writeFileSync(trackingPath, trackingJson)

    const globFiles = ['src/index.ts', 'src/utils.ts']

    const result = compareTrackedInputs(trackingPath, globFiles, tmpDir)

    expect(result).not.toBeNull()
    expect(result!.underSpecified).toContain('config.json')
    expect(result!.underSpecified).not.toContain('src/index.ts')
    expect(result!.overSpecified).toHaveLength(0)
    expect(result!.trackedReads).toContain('src/index.ts')
    expect(result!.trackedReads).toContain('src/utils.ts')
    expect(result!.trackedReads).toContain('config.json')
    expect(result!.trackedReads).not.toContain('/usr/lib/something')
  })

  test('identifies over-specified files', { retry: 2 }, async () => {
    const { compareTrackedInputs } = await import('../../src/tracking/compareTrackedInputs.js')
    const { writeFileSync, mkdirSync } = await import('fs')
    const tmpDir = join(cwd, '.test', `tracking-test-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })

    const trackingJson = JSON.stringify([{ path: join(tmpDir, 'src/index.ts'), mode: 'read' }])

    const trackingPath = join(tmpDir, 'tracked.json')
    writeFileSync(trackingPath, trackingJson)

    const globFiles = ['src/index.ts', 'src/unused.ts', 'src/also-unused.ts']

    const result = compareTrackedInputs(trackingPath, globFiles, tmpDir)

    expect(result).not.toBeNull()
    expect(result!.overSpecified).toContain('src/unused.ts')
    expect(result!.overSpecified).toContain('src/also-unused.ts')
    expect(result!.overSpecified).not.toContain('src/index.ts')
  })

  test('returns null for missing tracking file', { retry: 2 }, async () => {
    const { compareTrackedInputs } = await import('../../src/tracking/compareTrackedInputs.js')

    const result = compareTrackedInputs('/nonexistent/path.json', [], '/')
    expect(result).toBeNull()
  })
})
