import slugify from '@sindresorhus/slugify'
import escapeStringRegexp from 'escape-string-regexp'
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
   * @param {import('../project/project-types.js').Workspace} workspace
   * @param {string} name
   * @param {Config} config
   */
  constructor(workspace, name, config) {
    this.workspace = workspace
    this.name = name
    this._config = config
  }

  getManifestPath() {
    const dir = path.join(this.workspace.dir, '.lazy', 'manifests')
    return path.join(dir, slugify(this.name))
  }

  getNextManifestPath() {
    const dir = path.join(this.workspace.dir, '.lazy', 'manifests')
    return path.join(dir, slugify(this.name) + '.next')
  }

  getDiffPath() {
    const dir = path.join(this.workspace.dir, '.lazy', 'diffs')
    return path.join(dir, slugify(this.name))
  }

  get taskConfig() {
    return this._config.rootConfig.config.tasks?.[this.name] ?? {}
  }

  get execution() {
    return this.taskConfig.execution ?? 'dependent'
  }

  get baseCommand() {
    return this.taskConfig.baseCommand
  }

  /** @type {[string, RunsAfterConfig][]} */
  get runsAfterEntries() {
    return Object.entries(this.taskConfig.runsAfter ?? {}).map(([name, config]) => {
      return [name, new RunsAfterConfig(config)]
    })
  }

  get parallel() {
    return this.taskConfig.parallel ?? true
  }

  get recursive() {
    return this.taskConfig.recursive ?? 'error'
  }

  get cache() {
    const cache = this.taskConfig.cache
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

  get command() {
    const baseCommand = this.baseCommand
    const script = this.workspace.scripts[this.name]
    let command = this.execution === 'top-level' ? baseCommand : script

    if (!command) {
      logger.fail(`No command found for script ${this.name} in ${this.workspace.dir}/package.json`)
      process.exit(1)
    }

    if (this.execution !== 'top-level' && command.startsWith('lazy inherit')) {
      if (!baseCommand) {
        // TODO: evaluate this stuff ahead-of-time
        logger.fail(
          `Encountered 'lazy inherit' for scripts#${this.name} in ${this.workspace.dir}/package.json, but there is baseCommand configured for the task '${this.name}'`,
        )
        process.exit(1)
      }
      command = baseCommand + ' ' + command.slice('lazy inherit'.length)
      command = command.trim()
    }

    command = command.replaceAll('<rootDir>', this._config.project.root.dir)

    return command
  }

  get isPossiblyRecursive() {
    const regex = new RegExp(`lazy.*['"\\s]${escapeStringRegexp(this.name)}(?:['"\\s]|$)`, 'g')
    return !!this.command.match(regex)
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
  /** @readonly */ rootConfig
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
   * @param {import('../project/project-types.js').Workspace} workspace
   * @param {string} taskName
   * @returns {TaskConfig}
   */
  getTaskConfig(workspace, taskName) {
    return new TaskConfig(workspace, taskName, this)
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
