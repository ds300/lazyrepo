import slugify from '@sindresorhus/slugify'
import path, { isAbsolute, relative } from 'path'
import pc from 'picocolors'
import { logger } from '../logger/logger.js'
import { Project } from '../project/Project.js'
import { resolveConfig } from './resolveConfig.js'

export class RunsAfterConfig {
  /**
   * @private
   * @type {import('./config-types.js').RunsAfter}
   */
  _runsAfter

  constructor(/** @type {import('./config-types.js').RunsAfter} */ runsAfter) {
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
   * @param {import("./config-types.js").LazyTask} config
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
 * @param {import('./config-types.js').GlobConfig | null | undefined} glob
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
  /** @readonly */ project

  /**
   * @typedef {Object} ConfigWrapperOptions
   *
   * @property {Project} project
   * @property {import('./resolveConfig.js').ResolvedConfig} rootConfig
   */
  /** @param {ConfigWrapperOptions} options */
  constructor({ project, rootConfig }) {
    this.project = project
    this.rootConfig = rootConfig
  }

  /**
   * @param {string} cwd
   */
  static async fromCwd(cwd) {
    const project = Project.fromCwd(cwd)
    const rootConfig = await resolveConfig(project.root.dir)

    if (!rootConfig.filePath) {
      logger.log('No config files found, using default configuration.\n')
    } else {
      logger.log(pc.gray(`Loaded config file: ${relative(process.cwd(), rootConfig.filePath)}\n`))
    }

    return new Config({
      project,
      rootConfig,
    })
  }
  /**
   * @param {string} taskDir
   * @param {string} taskName
   * @returns {TaskConfig}
   */
  getTaskConfig(taskDir, taskName) {
    const config = this.rootConfig.config
    return new TaskConfig(taskDir, taskName, config?.tasks?.[taskName] ?? {})
  }

  /**
   * @param {string} taskDir
   * @param {string} taskName
   */
  getTaskKey(taskDir, taskName) {
    if (!isAbsolute(taskDir)) throw new Error(`taskKey: taskDir must be absolute: ${taskDir}`)
    return `${taskName}::${relative(this.project.root.dir, taskDir) || '<rootDir>'}`
  }

  /**
   * @returns {{include: string[], exclude: string[], envInputs: string[]}}
   */
  getBaseCacheConfig() {
    const config = this.rootConfig.config.baseCacheConfig

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
