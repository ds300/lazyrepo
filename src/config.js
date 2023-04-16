import slugify from '@sindresorhus/slugify'
import glob from 'fast-glob'
import path, { join, relative } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from './fs.js'
import { isTest } from './isTest.js'
import { logger } from './logger/logger.js'
import { workspaceRoot } from './workspaceRoot.js'

/**
 * @typedef {import('../index.js').LazyConfig} LazyConfig
 */

/**
 * @type {LazyConfig | null}
 */
let _config = null

/**
 * @returns {Promise<LazyConfig>}
 */
export async function getConfig() {
  if (_config) {
    return _config
  }

  const files = glob.sync('lazy.config.{js,cjs,mjs,ts,cts,mts,json}', {
    absolute: true,
    cwd: workspaceRoot,
  })

  if (files.length > 1) {
    logger.fail(`Found multiple lazy config files in dir '${workspaceRoot}'.`, {
      detail: `Remove all but one of the following files: ${files.join(', ')}`,
    })
  }

  if (files.length === 0) {
    logger.note('No config file found. Using defaults.')
    _config = {}
  } else {
    const file = files[0]
    logger.note(`Using config file: ${relative(process.cwd(), file)}`)
    _config = await loadConfig(file)

    if (!_config) {
      throw new Error(`Invalid config file`)
    }
  }

  return _config
}

/**
 * @param {string} file
 * @returns {Promise<LazyConfig>}
 */
async function loadConfig(file) {
  if (file.endsWith('.json')) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  if (file.endsWith('.js') || file.endsWith('.cjs') || file.endsWith('.mjs')) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return (await import(file)).default
  }

  const configDir = join(workspaceRoot, '.lazy')
  if (!existsSync(configDir)) {
    mkdirSync(configDir)
  }

  const inFile = join(configDir, 'config.source.mjs')
  writeFileSync(inFile, `import config from '${file}'; export default config`)
  const outFile = join(configDir, 'config.cache.mjs')

  const esbuild = await import('esbuild')
  await esbuild.build({
    entryPoints: [inFile],
    outfile: outFile,
    bundle: true,
    sourcemap: 'inline',
    sourcesContent: true,
    format: 'esm',
  })

  if (!isTest) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    await import('source-map-support/register.js')
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return (await import(outFile)).default
}

/**
 * @param {{ taskName: string }} param0
 * @returns
 */
export async function getTask({ taskName }) {
  return (await getConfig()).tasks?.[taskName] ?? {}
}

/**
 * @param {{ taskName: string, taskDir: string }} param0
 * @returns
 */
export function getManifestPath({ taskName, taskDir }) {
  const dir = path.join(taskDir, '.lazy', 'manifests')
  return path.join(dir, slugify(taskName))
}

/**
 * @param {{ taskName: string, taskDir: string }} param0
 * @returns
 */
export function getNextManifestPath({ taskName, taskDir }) {
  const dir = path.join(taskDir, '.lazy', 'manifests')
  return path.join(dir, slugify(taskName) + '.next')
}

/**
 * @param {{ taskName: string, taskDir: string }} param0
 * @returns
 */
export function getDiffPath({ taskName, taskDir }) {
  const dir = path.join(taskDir, '.lazy', 'diffs')
  return path.join(dir, slugify(taskName))
}
