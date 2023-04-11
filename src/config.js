import slugify from '@sindresorhus/slugify'
import kleur from 'kleur'
import path from 'path'
import { loadConfig } from 'unconfig'
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

  /** @type {import('unconfig').LoadConfigResult<LazyConfig>} */
  const { config, sources } = await loadConfig({
    sources: [
      {
        files: 'lazy.config',
        extensions: ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'json'],
      },
    ],
    merge: true,
  })

  if (sources.length > 1) {
    log.fail(`Found multiple lazy config files in dir '${workspaceRoot}'.`, {
      detail: `Remove all but one of the following files: ${sources.join(', ')}`,
    })
  }

  if (sources.length === 0) {
    console.log(kleur.gray('No config file found. Using defaults.'))
    _config = {}
  } else {
    const file = sources[0]
    console.log(kleur.gray(`Using config file: ${file}`))
    _config = config

    if (!_config) {
      throw new Error(`Invalid config file`)
    }
  }

  return _config
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
