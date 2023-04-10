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
  terminalPrefix: string
  inputManifestCacheKey: string | null
  packageDetails: PackageDetails | null
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
       * Any environment variables that this task uses
       */
      inputEnvVars?: string[]
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

export interface TaskConfig {
  /**
   * Run the task in the root directory only.
   *
   * @default false
   */
  topLevel?: boolean
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
   * Whether or not the task must be executed in dependency order.
   *
   * If true, the ordering does not matter.
   * If false, the task will be executed based on topological dependency order.
   *
   * @default false
   */
  independent?: boolean

  /**
   * Whether this task can be safely executed in parallel with other instances of the same task.
   *
   * @default true
   */
  parallel?: boolean

  /**
   * The default command to run for this task if the scripts entry uses `lazy :inherit`
   */
  defaultCommand?: string
}

export interface LazyConfig {
  /** Globs of any files that should contribute to the cache key for all steps. */
  globalDependencies?: string[]
  /** Globs of any files that should _never_ contribute to the cache key for all steps. These cannot be overridden. */
  globalExcludes?: string[]
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
