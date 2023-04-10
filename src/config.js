import slugify from '@sindresorhus/slugify'
import glob from 'fast-glob'
import { readFileSync } from 'fs'
import kleur from 'kleur'
import path from 'path'
import { log } from './log.js'
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
    log.fail(`Found multiple lazy config files in dir '${workspaceRoot}'.`, {
      detail: `Remove all but one of the following files: ${files.join(', ')}`,
    })
  }
  if (files.length === 0) {
    console.log(kleur.gray('No config file found. Using defaults.'))
    _config = {}
  } else {
    const file = files[0]
    console.log(kleur.gray(`Using config file: ${file}`))
    _config = await loadConfigFromFile(file)

    if (!_config) {
      throw new Error(`Invalid config file '${file}'`)
    }
  }

  return _config
}

/**
 * @param {string} file
 * @returns {Promise<LazyConfig>}
 */
async function loadConfigFromFile(file) {
  if (file.endsWith('.json')) {
    return JSON.parse(readFileSync(file, 'utf8'))
  } else if (file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.cts')) {
    const { build } = await import('esbuild')
    const result = await build({
      absWorkingDir: workspaceRoot,
      entryPoints: [file],
      outfile: 'out.js',
      target: 'esnext',
      platform: 'node',
      sourcemap: 'inline',
      format: 'esm',
      write: false,
    })
    const { text } = result.outputFiles[0]

    const dataUrl = `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`

    return (await import(dataUrl)).default
  } else {
    return (await import(file)).default
  }
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
