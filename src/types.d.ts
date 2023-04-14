export type TaskStatus = 'pending' | 'running' | 'success:eager' | 'success:lazy' | 'failure'

export interface ScheduledTask {
  key: string
  taskName: string
  taskDir: string
  status: TaskStatus
  filterPaths: string[]
  force: boolean
  extraArgs: string[]
  outputFiles: string[]
  dependencies: string[]
  inputManifestCacheKey: string | null
  packageDetails: PackageDetails | null
  logger: TaskLogger
}

export type PackageDetails = {
  name: string
  dir: string
  localDeps: string[]
  version: string
  scripts: Record<string, string>
}

export type RepoDetails = {
  packagesByName: Record<string, PackageDetails>
  packagesInTopologicalOrder: PackageDetails[]
}

export type GlobConfig = string[] | { include?: string[]; exclude?: string[] }

export type CacheConfig =
  | 'none'
  | {
      /**
       * Globs of files that this task depends on.
       *
       * If none are specified, all files in the package will be used.
       */
      inputs?: GlobConfig
      /**
       * Globs of files that this task produces.
       *
       * If none are specified, none will be tracked.
       */
      outputs?: GlobConfig
      /**
       * The names of any environment variables that should contribute to the cache key of this task.
       * Note that it will not control which env vars are passed to the task in any way.
       */
      envInputs?: string[]
      /**
       * If this task is not independent, this controls whether or not the output created by
       * upstream packages running this task counts towards the input for the current package.
       *
       * @default true
       */
      usesOutputFromDependencies?: boolean
      /**
       * If this task is not independent, this controls whether or not the inputs used by
       * upstream packages running this task count towards the input for the current package.
       *
       * @default true
       */
      inheritsInputFromDependencies?: boolean
    }

type BaseTaskConfig = {
  /** The other commands that must be completed before this one can run. */
  runsAfter?: {
    [taskName: string]: {
      /**
       * Whether or not this task uses the files created by the named task.
       * If true, they will be included as cache inputs.
       *
       * @default true
       */
      usesOutput?: boolean
      /**
       * Whether or not the input files of the named task should contribute to the
       * cache inputs of this task.
       *
       * @default false
       */
      inheritsInput?: boolean
    }
  }

  /**
   * The configuration for the input + output caches.
   *
   * Set to `"none"` to disable caching and make sure the task will always execute when invoked.
   *
   * @default { inputs: ["**\/*"] }
   */
  cache?: CacheConfig

  /**
   * Whether this task can be safely executed in parallel with other instances of the same task.
   *
   * @default true
   */
  parallel?: boolean
}

export interface TopLevelTaskConfig extends BaseTaskConfig {
  /**
   * The execution strategy for this task
   *
   * "dependent" (default)
   *
   *   The task will run in workspace package directories. It will run in topological order based
   *   on the dependencies listed in package.json files.
   *
   *   Any tasks that do not depend on each other may be run in parallel, unless specified otherwise.
   *
   * "independent"
   *
   *   The task will run in workspace package directories, in parallel unless specified otherwise.
   *
   * "top-level"
   *
   *   The task will run in the root directory of the repo.
   *   You must specify a command to run.
   *   You may also want to add a `package.json` script with the same name that calls `lazy`.
   */
  runType: 'top-level'
  /**
   * The command to run for this task
   */
  baseCommand: string
}

export interface PackageLevelTaskConfig extends BaseTaskConfig {
  /**
   * The execution strategy for this task
   *
   * "dependent" (default)
   *
   *   The task will run in workspace package directories. It will run in topological order based
   *   on the dependencies listed in package.json files.
   *
   *   Any tasks that do not depend on each other may be run in parallel, unless specified otherwise.
   *
   * "independent"
   *
   *   The task will run in workspace package directories, in parallel unless specified otherwise.
   *
   * "top-level"
   *
   *   The task will run in the root directory of the repo.
   *   You must specify a command to run.
   *   You may also want to add a `package.json` script with the same name that calls `lazy`.
   *
   */
  runType?: 'dependent' | 'independent'
  /**
   * The command to run for this task if the task uses `lazy :inherit`
   */
  baseCommand?: string
}

export type TaskConfig = TopLevelTaskConfig | PackageLevelTaskConfig

export interface LazyConfig {
  /**
   * Cache configuration that will be applied to every task.
   *
   * Note that these glob patterns are evaluated in the task's directory, which is usually not the workspace root directory.
   * If you want to specify a glob pattern that is relative to the root, prefix the pattern with `<rootDir>/`.
   *
   * @example
   * baseCacheConfig: {
   *   // Include the root package.json in every tasks' cache key
   *   includes: ['<rootDir>/package.json'],
   *   // Ignore dist folder in every package directory
   *   excludes: ['dist/**\/*']
   * }
   *
   * @default {includes: ['<rootDir>/{yarn.lock,pnpm-lock.yaml,package-lock.json}']}
   */
  baseCacheConfig?: {
    /**
     * Globs of files that should be included in every task's input manifest.
     *
     * Note that these glob patterns are evaluated in the task's directory, which is usually not the workspace root directory.
     * If you want to specify a glob pattern that is relative to the root, prefix the pattern with `<rootDir>/`.
     */
    includes?: string[]
    /**
     * Globs of files that should be excluded from every task's input manifest.
     *
     * Note that these glob patterns are evaluated in the task's directory, which is usually not the workspace root directory.
     * If you want to specify a glob pattern that is relative to the root, prefix the pattern with `<rootDir>/`.
     */
    excludes?: string[]
    /**
     * The names of any environment variables that should be included in every task's input manifest.
     */
    envInputs?: string[]
  }
  /**
   * Custom configuration for any tasks defined in your package.json "scripts" entries.
   */
  tasks?: { [taskName: string]: TaskConfig }
}

export type ManifestChange = {
  type: 'addition' | 'removal' | 'modification'
  value: string
}

export type CLITaskDescription = {
  taskName: string
  filterPaths: string[]
  extraArgs: string[]
  force: boolean
}

export type CLIOption = {
  force: boolean
  filter?: string | string[]
  '--': string[]
}

export interface Logger {
  log(...message: string[]): void
  logErr(...message: string[]): void

  info(...message: string[]): void
  note(...message: string[]): void
  success(...message: string[]): void
  fail(headline: string, more?: { error?: Error; detail?: string }): void
}

export interface PackageJson {
  name: string
  version: string
  dependencies?: { [depName: string]: string }
  devDependencies?: { [depName: string]: string }
  peerDependencies?: { [depName: string]: string }
  optionalDependencies?: { [depName: string]: string }
  scripts?: { [scriptName: string]: string }
  workspaces?: string[]
}

export interface TaskLogger extends Logger {
  restartTimer(): void
}

export interface CliLogger extends Logger {
  task(taskName: string, sortOrder: number): TaskLogger
}
