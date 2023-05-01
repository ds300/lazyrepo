import slugify from '@sindresorhus/slugify'
import micromatch from 'micromatch'
import { isAbsolute, join, relative } from 'path'
import pc from 'picocolors'
import { logger } from '../logger/logger.js'
import { Project } from '../project/Project.js'
import { resolveConfig } from './resolveConfig.js'

/**
 * @param {import('./config-types.js').LazyScript} script
 * @returns {script is import('./config-types.js').DependentScript}
 */
function isDependentScript(script) {
  return script.execution === undefined || script.execution === 'dependent'
}

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

  get urlSafeName() {
    // Script names can contain any character, so let's slugify them and add a hex-encoded full name to avoid slug collisions
    // h/t wireit https://github.com/google/wireit/blob/27712b767dbebd90460049a3daf87329b9fb3279/src/util/script-data-dir.ts#L25
    const slug = slugify(this.name)
    if (slug !== this.name) {
      return slug + '-' + Buffer.from(this.name).toString('hex')
    }
    return this.name
  }

  /** @private */
  get dataDir() {
    return join(this.workspace.dir, '.lazy', this.urlSafeName)
  }

  getManifestPath() {
    return join(this.dataDir, 'manifest.tsv')
  }

  getOutputManifestPath() {
    return join(this.dataDir, 'output-manifest.tsv')
  }

  getNextManifestPath() {
    return join(this.dataDir, 'manifest.next.tsv')
  }

  getDiffPath() {
    return join(this.dataDir, 'diff.log')
  }

  getOutputPath() {
    return join(this.dataDir, 'output')
  }

  getLogPath() {
    return join(this.dataDir, 'output.log')
  }

  getAnsiLogPath() {
    return join(this.dataDir, 'output.ansi.log')
  }

  /**
   * @private
   * @param {string[]} patterns
   */
  formatMultimatchError(patterns) {
    return `Workspace '${relative(
      process.cwd(),
      this.workspace.dir,
    )}' matched multiple overrides for script "${this.name}": [${patterns
      .sort()
      .map((pattern) => `'${pattern}'`)
      .join(', ')}]\nPlease make sure that the workspace only matches one override.`
  }

  /**
   * @private
   * @returns {import('./config-types.js').LazyScript}
   */
  get scriptConfig() {
    const rawConfig = this._config.rootConfig.config.scripts?.[this.name]
    if (!rawConfig) return {}

    if (rawConfig?.execution === 'top-level') return rawConfig
    const overrides = rawConfig?.workspaceOverrides
    if (!overrides) {
      return rawConfig
    }
    const patterns = Object.keys(overrides)
    const nameMatches = patterns.filter((pattern) =>
      micromatch.isMatch(this.workspace.name, pattern),
    )
    if (nameMatches.length > 1) {
      throw new Error(this.formatMultimatchError(nameMatches))
    }
    const dirMatches = patterns.filter((pattern) =>
      micromatch.isMatch(this.workspace.dir, join(this._config.project.root.dir, pattern)),
    )
    if (dirMatches.length > 1) {
      throw new Error(this.formatMultimatchError(dirMatches))
    }

    if (nameMatches.length === 0 && dirMatches.length === 0) {
      return rawConfig
    }

    if (nameMatches.length === 1 && dirMatches.length === 1 && nameMatches[0] !== dirMatches[0]) {
      throw new Error(this.formatMultimatchError(nameMatches.concat(dirMatches)))
    }

    const overrideConfig = overrides[nameMatches[0] ?? dirMatches[0]]

    return {
      ...rawConfig,
      ...overrideConfig,
    }
  }

  /** @returns {import('./config-types.js').LogMode} */
  get logMode() {
    return this.scriptConfig.logMode ?? 'new-only'
  }

  /** @returns {import('./config-types.js').LazyScript['execution']} */
  get execution() {
    return this.scriptConfig.execution ?? 'dependent'
  }

  /** @returns {string | undefined} */
  get baseCommand() {
    return this.scriptConfig.baseCommand
  }

  /** @type {[string, RunsAfterConfig][]} */
  get runsAfterEntries() {
    if (this.scriptConfig.execution === 'top-level') return []
    return Object.entries(this.scriptConfig.runsAfter ?? {}).map(([name, config]) => {
      return [name, new RunsAfterConfig(config)]
    })
  }

  /** @type {boolean} */
  get parallel() {
    if (this.scriptConfig.execution === 'top-level') return false
    return this.scriptConfig.parallel ?? true
  }

  get cache() {
    if (this.scriptConfig.cache === 'none') {
      return this.scriptConfig.cache
    } else {
      const inheritsInputFromDependencies = isDependentScript(this.scriptConfig)
        ? this.scriptConfig.cache?.inheritsInputFromDependencies ?? true
        : false

      const usesOutputFromDependencies = isDependentScript(this.scriptConfig)
        ? this.scriptConfig.cache?.usesOutputFromDependencies ?? true
        : false

      return {
        envInputs: this.scriptConfig.cache?.envInputs ?? [],
        inputs: extractGlobPattern(this.scriptConfig.cache?.inputs, ['**/*']),
        outputs: extractGlobPattern(this.scriptConfig.cache?.outputs, []),
        inheritsInputFromDependencies,
        usesOutputFromDependencies,
      }
    }
  }

  /** @type {string} */
  get command() {
    const baseCommand = this.baseCommand
    const script = this.workspace.scripts[this.name]
    let command = this.execution === 'top-level' ? baseCommand : script

    if (!command) {
      throw logger.fail(
        `No command found for script ${this.name} in ${this.workspace.dir}/package.json`,
      )
    }

    if (this.execution !== 'top-level') {
      const inheritMatch = extractInheritMatch(command)

      if (inheritMatch) {
        if (!baseCommand) {
          // TODO: evaluate this stuff ahead-of-time
          throw logger.fail(
            `Encountered 'lazy inherit' for scripts#${this.name} in ${this.workspace.dir}/package.json, but there is no baseCommand configured for the task '${this.name}'`,
          )
        } else {
          command = `${inheritMatch.envVars ?? ''} ${baseCommand} ${inheritMatch.extraArgs ?? ''}`
          command = command.trim()
        }
      }
    }

    command = command.replaceAll('<rootDir>', this._config.project.root.dir)

    return command
  }
}

/**
 * TODO: can we use @yarnpkg/shell parser here?
 * @param {string} command
 */
export function extractInheritMatch(command) {
  const match = command.match(/^(\w+=\S* )*(yarn run( -T| --top-level)? )?lazy inherit($| .*$)/)
  if (!match) return null

  const [, envVars, , , extraArgs] = match

  return { envVars: envVars?.trim() || null, extraArgs: extraArgs?.trim() || null }
}

/**
 * @param {import('./config-types.js').GlobConfig | null | undefined} glob
 * @param {string[]} defaultInclude
 * @returns {{include: string[];exclude: string[];}}
 */
function extractGlobPattern(glob, defaultInclude) {
  if (!glob) {
    return {
      include: defaultInclude,
      exclude: [],
    }
  }
  if (Array.isArray(glob)) {
    return {
      include: glob,
      exclude: [],
    }
  }

  return { include: glob.include ?? defaultInclude, exclude: glob.exclude ?? [] }
}

export class Config {
  /** @readonly */ rootConfig
  /** @readonly */ project

  /**
   * @typedef {Object} ConfigWrapperOptions
   *
   * @property {Project} project
   * @property {import('./resolveConfig.js').ResolvedConfig} rootConfig
   * @property {boolean} isVerbose
   */
  /** @param {ConfigWrapperOptions} options */
  constructor({ project, rootConfig, isVerbose }) {
    this.project = project
    this.rootConfig = rootConfig
    this.isVerbose = !!isVerbose
  }

  /**
   * @param {string} cwd
   */
  static async fromCwd(cwd, isVerbose = false) {
    let project = Project.fromCwd(cwd)
    const rootConfig = await resolveConfig(project.root.dir)
    project = project.withoutIgnoredWorkspaces(rootConfig.config.ignoreWorkspaces ?? [])

    if (!rootConfig.filePath) {
      logger.log('No config files found, using default configuration.\n')
    } else {
      logger.log(pc.gray(`Loaded config file: ${relative(process.cwd(), rootConfig.filePath)}\n`))
    }

    return new Config({
      project,
      rootConfig,
      isVerbose,
    })
  }
  /**
   * @param {import('../project/project-types.js').Workspace} workspace
   * @param {string} scriptName
   * @returns {TaskConfig}
   */
  getTaskConfig(workspace, scriptName) {
    return new TaskConfig(workspace, scriptName, this)
  }

  /**
   * @param {string} scriptName
   */
  isTopLevelScript(scriptName) {
    return this.rootConfig.config.scripts?.[scriptName]?.execution === 'top-level'
  }

  /**
   * @param {string} taskDir
   * @param {string} scriptName
   */
  getTaskKey(taskDir, scriptName) {
    if (!isAbsolute(taskDir)) throw new Error(`taskKey: taskDir must be absolute: ${taskDir}`)
    return `${scriptName}::${relative(this.project.root.dir, taskDir) || '<rootDir>'}`
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
