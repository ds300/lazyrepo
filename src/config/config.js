import slugify from '@sindresorhus/slugify'
import path, { isAbsolute, relative } from 'path'
import pc from 'picocolors'
import { getWorkspaceRoot } from '../getWorkspaceRoot.js'
import { logger } from '../logger/logger.js'
import { getPackageManager, getRepoDetails } from '../workspace.js'
import { resolveConfig } from './resolveConfig.js'

/**
 * @typedef {import('../../index.js').LazyConfig} LazyConfig
 */

/**
 * @typedef {import('./resolveConfig.js').ResolvedConfig} ResolvedConfig
 */

export class RunsAfterConfig {
  /**
   * @private
   * @type {import('../types.js').RunsAfter}
   */
  _runsAfter

  constructor(/** @type {import('../types.js').RunsAfter} */ runsAfter) {
    this._runsAfter = runsAfter
  }

  get usesOutput() {
    return this._runsAfter.usesOutput ?? true
  }

  get inheritsInput() {
    return this._runsAfter.inheritsInput ?? false
  }

  get in() {
    return this._runsAfter.in ?? 'all-packages'
  }
}

export class TaskConfig {
  /** @private  */
  _config
  /**
   * @param {string} dir
   * @param {string} name
   * @param {import("../types.js").LazyTask} config
   */
  constructor(dir, name, config) {
    this.dir = dir
    this.name = name
    this._config = config
  }

  getManifestPath() {
    const dir = path.join(this.dir, '.lazy', 'manifests')
    return path.join(dir, slugify(this.name))
  }

  getNextManifestPath() {
    const dir = path.join(this.dir, '.lazy', 'manifests')
    return path.join(dir, slugify(this.name) + '.next')
  }

  getDiffPath() {
    const dir = path.join(this.dir, '.lazy', 'diffs')
    return path.join(dir, slugify(this.name))
  }

  get execution() {
    return this._config.execution ?? 'dependent'
  }

  get baseCommand() {
    return this._config.baseCommand
  }

  /** @type {[string, RunsAfterConfig][]} */
  get runsAfterEntries() {
    return Object.entries(this._config.runsAfter ?? {}).map(([name, config]) => {
      return [name, new RunsAfterConfig(config)]
    })
  }

  get parallel() {
    return this._config.parallel ?? true
  }

  get cache() {
    const cache = this._config.cache
    if (cache === 'none') {
      return cache
    } else {
      return {
        envInputs: cache?.envInputs ?? [],
        inheritsInputFromDependencies: cache?.inheritsInputFromDependencies ?? true,
        inputs: extractGlobPattern(cache?.inputs),
        outputs: extractGlobPattern(cache?.outputs),
        usesOutputFromDependencies: cache?.usesOutputFromDependencies ?? true,
      }
    }
  }
}

/**
 *
 * @param {import('../types.js').GlobConfig | null | undefined} glob
 * @returns {{include: string[], exclude: string[]}}
 */
function extractGlobPattern(glob) {
  if (!glob) {
    return {
      include: ['**/*'],
      exclude: [],
    }
  }
  if (Array.isArray(glob)) {
    return {
      include: glob,
      exclude: [],
    }
  }

  return { include: glob.include ?? ['**/*'], exclude: glob.exclude ?? [] }
}

export class Config {
  /** @private */ rootConfig
  /** @private */ packageDirConfigs
  /** @readonly */ workspaceRoot
  /** @readonly */ repoDetails

  /**
   * @typedef {Object} ConfigWrapperOptions
   *
   * @property {string} workspaceRoot
   * @property {ResolvedConfig} rootConfig
   * @property {Record<string, ResolvedConfig>} packageDirConfigs
   * @property {import('../types.js').RepoDetails} repoDetails
   */
  /** @param {ConfigWrapperOptions} options */
  constructor({ workspaceRoot, rootConfig, packageDirConfigs, repoDetails }) {
    this.workspaceRoot = workspaceRoot
    this.rootConfig = rootConfig
    this.packageDirConfigs = packageDirConfigs
    this.repoDetails = repoDetails
  }

  /**
   * @param {string} dir
   */
  static async from(dir) {
    const workspaceRoot = getWorkspaceRoot(dir)
    if (!workspaceRoot) {
      logger.fail(`Could not find workspace root for dir '${dir}'`)
      process.exit(1)
    }

    const packageManager = getPackageManager(workspaceRoot)
    if (!packageManager) {
      logger.fail(`Could not determine which package manager is in use '${dir}' '${workspaceRoot}'`)
    }

    const repoDetails = getRepoDetails(workspaceRoot)
    const rootConfig = await resolveConfig(workspaceRoot)

    /** @type {Record<string, ResolvedConfig>} */
    const packageDirConfigs = {}
    const allLoadedConfigFiles = rootConfig.filePath ? [rootConfig.filePath] : []

    for (const c of await Promise.all(
      Object.values(repoDetails.packagesByName).map(async (pkg) => ({
        dir: pkg.dir,
        config: await resolveConfig(pkg.dir),
      })),
    )) {
      if (c.config.filePath !== null) {
        allLoadedConfigFiles.push(c.config.filePath)
        packageDirConfigs[c.dir] = c.config
      }
    }

    if (allLoadedConfigFiles.length === 0) {
      logger.log('No config files found, using default configuration.\n')
    } else {
      logger.log(
        pc.gray(
          `Loaded config file${allLoadedConfigFiles.length > 1 ? 's' : ''}: ${allLoadedConfigFiles
            .map((f) => relative(process.cwd(), f))
            .join(', ')}\n`,
        ),
      )
    }

    return new Config({
      workspaceRoot,
      rootConfig,
      packageDirConfigs,
      repoDetails,
    })
  }
  /**
   * @param {string} taskDir
   * @param {string} taskName
   * @returns {TaskConfig}
   */
  getTaskConfig(taskDir, taskName) {
    const config = this.packageDirConfigs[taskDir]?.config ?? this.rootConfig.config
    return new TaskConfig(taskDir, taskName, config?.tasks?.[taskName] ?? {})
  }

  /**
   * @param {string} taskDir
   * @param {string} taskName
   */
  getTaskKey(taskDir, taskName) {
    if (!isAbsolute(taskDir)) throw new Error(`taskKey: taskDir must be absolute: ${taskDir}`)
    return `${taskName}::${relative(this.workspaceRoot, taskDir) || '<rootDir>'}`
  }

  /**
   * @param {string} taskDir
   * @returns {{include: string[], exclude: string[], envInputs: string[]}}
   */
  getBaseCacheConfig(taskDir) {
    const config =
      this.packageDirConfigs[taskDir]?.config.baseCacheConfig ??
      this.rootConfig.config.baseCacheConfig

    const include = config?.include ?? [
      '<rootDir>/{yarn.lock,pnpm-lock.yaml,package-lock.json}',
      '<rootDir>/lazy.config.*',
    ]
    const exclude = config?.exclude ?? []
    return {
      include,
      exclude,
      envInputs: config?.envInputs ?? [],
    }
  }
}
