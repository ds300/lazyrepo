import slugify from '@sindresorhus/slugify'
import glob from 'fast-glob'
import { readFileSync } from 'fs'
import kleur from 'kleur'
import path from 'path'
import { logger } from './log.js'
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

  const files = glob.sync('lazy.config.{js,cjs,mjs,json}', { absolute: true, cwd: workspaceRoot })
  if (files.length > 1) {
    logger.fail(`Found multiple lazy config files in dir '${workspaceRoot}'.`, {
      detail: `Remove all but one of the following files: ${files.join(', ')}`,
    })
  }
  if (files.length === 0) {
    logger.note(kleur.gray('No config file found. Using defaults.'))
    _config = {}
  } else {
    const file = files[0]
    logger.note(kleur.gray(`Using config file: ${file}`))
    if (file.endsWith('.json')) {
      _config = JSON.parse(readFileSync(file, 'utf8'))
    } else {
      _config = (await import(file)).default
    }

    if (!_config) {
      throw new Error(`Invalid config file '${file}'`)
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
