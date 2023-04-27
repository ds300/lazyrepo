import spawn from 'cross-spawn'
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'fs'
import { nanoid } from 'nanoid'
import { join } from 'path'
import stripAnsi from 'strip-ansi'
import { LazyConfig } from '../../index.js'
import { execCli } from '../../src/execCli.js'
import { naiveRimraf } from '../../src/naiveRimraf.js'
import { PackageJson } from '../../src/types.js'

const cleanup = ({ text, rootDir }: { text: string; rootDir: string }) =>
  stripAnsi(text)
    .replace(/DEBUG.*\n/g, '')
    .replaceAll(rootDir, '__ROOT_DIR__')

class TestHarness {
  constructor(readonly config: { dir: string; packageManager: PackageManager; spawn?: boolean }) {}
  edit(path: string) {
    if (!existsSync(join(this.config.dir, path))) {
      throw new Error(`File does not exist: ${path}`)
    }
    writeFileSync(join(this.config.dir, path), nanoid(), 'utf-8')
  }

  touch(path: string) {
    if (!existsSync(join(this.config.dir, path))) {
      throw new Error(`File does not exist: ${path}`)
    }
    // update the mtime of the file
    utimesSync(join(this.config.dir, path), new Date(), new Date())
  }

  getMtime(path: string) {
    if (!existsSync(join(this.config.dir, path))) {
      throw new Error(`File does not exist: ${path}`)
    }

    return statSync(join(this.config.dir, path)).mtime.getTime()
  }

  read(path: string) {
    return readFileSync(join(this.config.dir, path), 'utf-8')
  }

  exists(path: string) {
    return existsSync(join(this.config.dir, path))
  }

  write(path: string, contents: string) {
    writeFileSync(join(this.config.dir, path), contents, 'utf-8')
  }

  remove(path: string) {
    naiveRimraf(join(this.config.dir, path))
  }

  install() {
    spawn.sync(`${this.config.packageManager} install`, {
      cwd: this.config.dir,
      shell: true,
      stdio: [null, 'ignore', 'inherit'],
    })
  }

  exec(
    args: string[],
    options?: {
      packageDir?: string
      env?: NodeJS.ProcessEnv
      expectError?: boolean
      inspect?: boolean
    },
  ) {
    return this.config.spawn
      ? this.execInSpawnedProc(args, options)
      : this.execInBand(args, options)
  }

  private async execInBand(
    args: string[],
    options?: { packageDir?: string; env?: NodeJS.ProcessEnv; expectError?: boolean },
  ) {
    const expectError = options?.expectError ?? false
    const cwd = jest.spyOn(process, 'cwd').mockImplementation(() => this.config.dir)
    let output = ''
    const outWrite = jest.spyOn(process.stdout, 'write').mockImplementation((data) => {
      output += data
      return true
    })

    const errWrite = jest.spyOn(process.stderr, 'write').mockImplementation((data) => {
      output += data
      return true
    })
    let status = 0
    const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      status = code ?? 0
      return undefined as never
    })
    try {
      await execCli(['node', join(process.cwd(), 'bin.js'), ...args])
      const didError = status === 1
      if ((expectError && didError) || (!expectError && !didError)) {
        return { output: cleanup({ text: output, rootDir: this.config.dir }), status }
      }
      console.error(cleanup({ text: output, rootDir: this.config.dir }))
      throw new Error(
        `Exited with code ${status} ${cleanup({ text: output, rootDir: this.config.dir })}`,
      )
    } finally {
      cwd.mockRestore()
      outWrite.mockRestore()
      errWrite.mockRestore()
      exit.mockRestore()
    }
  }

  private execInSpawnedProc(
    args: string[],
    options?: {
      packageDir?: string
      env?: NodeJS.ProcessEnv
      expectError?: boolean
      inspect?: boolean
    },
  ): Promise<{ output: string; status: number }> {
    const expectError = options?.expectError ?? false
    return new Promise((resolve, reject) => {
      const proc = spawn(
        'node',
        [...(options?.inspect ? ['--inspect'] : []), join(process.cwd(), 'bin.js'), ...args],
        {
          cwd: options?.packageDir ? join(this.config.dir, options.packageDir) : this.config.dir,
          env: {
            ...process.env,
            __test__FORCE_CI: 'false',
            ...options?.env,
          },
        },
      )

      let output = ''
      proc.stdout?.on('data', (data) => {
        output += data
      })
      proc.stderr?.on('data', (data) => {
        output += data
      })
      proc.on('exit', (code) => {
        const didError = code === 1
        if ((expectError && didError) || (!expectError && !didError)) {
          resolve({
            output: cleanup({ text: output, rootDir: this.config.dir }),
            status: code ?? 1,
          })
        } else {
          console.error(output)
          reject(
            new Error(
              `Exited with code ${code} ${cleanup({ text: output, rootDir: this.config.dir })}`,
            ),
          )
        }
      })
      proc.on('error', (err) => {
        reject(err)
      })
    })
  }
}

export type Dir = { [fileName: string]: File }
export type File = string | Dir | undefined

const create = (path: string, file: File) => {
  if (typeof file === 'undefined') {
    // ignore
  } else if (typeof file === 'string') {
    // create file
    writeFileSync(path, file, 'utf-8')
  } else {
    // create dir
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true })
    }
    Object.entries(file).forEach(([fileName, file]) => {
      create(join(path, fileName), file)
    })
  }
}

type PackageManager = 'yarn' | 'npm' | 'pnpm'

export async function runIntegrationTest(
  config: {
    packageManager: 'yarn' | 'npm' | 'pnpm'
    workspaceGlobs: string[]
    structure: Dir
  },
  fn: (t: TestHarness) => Promise<void>,
) {
  const dir = join(process.cwd(), '.test', nanoid())
  // create file structure in dir

  create(dir, {
    'pnpm-lock.yaml': config.packageManager === 'pnpm' ? '' : undefined,
    'yarn.lock': config.packageManager === 'yarn' ? '' : undefined,
    'package-lock.json': config.packageManager === 'npm' ? '' : undefined,
    'pnpm-workspace.yaml':
      config.packageManager === 'pnpm' ? makeWorkspaceYaml(config.workspaceGlobs) : undefined,
    'package.json': makePackageJson({
      type: 'module',
      workspaces: config.packageManager === 'pnpm' ? undefined : config.workspaceGlobs,
    }),
    ...config.structure,
  })

  const t = new TestHarness({ dir, packageManager: config.packageManager, spawn: true })
  await fn(t)
}

export function makePackageJson(opts: Partial<PackageJson>) {
  return JSON.stringify({
    name: 'test',
    version: '1.0.0-test',
    ...opts,
  })
}

export function makeConfigFile(config: LazyConfig) {
  return `export default ${JSON.stringify(config)}`
}

function makeWorkspaceYaml(globs: string[]) {
  return `packages:\n${globs.map((glob) => `  - ${glob}`).join('\n')}\n`
}
