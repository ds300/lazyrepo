/* eslint-disable jest/no-export */
import spawn from 'cross-spawn'
import { existsSync, mkdirSync, statSync, utimesSync, writeFileSync } from 'fs'
import { nanoid } from 'nanoid'
import { join } from 'path'
import { PackageJson } from '../../src/types.js'

class TestHarness {
  constructor(readonly config: { dir: string; packageManager: PackageManager }) {}
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

    return statSync(join(this.config.dir, path)).mtime.toISOString()
  }

  exists(path: string) {
    return existsSync(join(this.config.dir, path))
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
    options?: { packageDir?: string; env?: NodeJS.ProcessEnv },
  ): Promise<{ output: string; status: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', [join(process.cwd(), 'bin.js'), ...args], {
        cwd: options?.packageDir ? join(this.config.dir, options.packageDir) : this.config.dir,
        env: {
          ...process.env,
          ...options?.env,
        },
      })

      let output = ''
      proc.stdout?.on('data', (data) => {
        output += data
      })
      proc.stderr?.on('data', (data) => {
        output += data
      })
      proc.on('exit', (code) => {
        if (code === 0) {
          resolve({ output, status: code })
        } else {
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
          reject(new Error(`Exited with code ${code}`))
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
    'pnpm-workspace.yaml':
      config.packageManager === 'pnpm' ? makeWorkspaceYaml(config.workspaceGlobs) : undefined,
    'package.json': makePackageJson({
      workspaces: config.packageManager === 'pnpm' ? undefined : config.workspaceGlobs,
    }),
    ...config.structure,
  })

  const t = new TestHarness({ dir, packageManager: config.packageManager })
  await fn(t)
}

export function makePackageJson(opts: Partial<PackageJson>) {
  return JSON.stringify({
    name: 'test',
    version: '1.0.0-' + nanoid(),
    ...opts,
  })
}

function makeWorkspaceYaml(globs: string[]) {
  return `packages:\n${globs.map((glob) => `  - ${glob}`).join('\n')}\n`
}
