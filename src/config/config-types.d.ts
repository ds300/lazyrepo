/**
 * Either a list of include globs, or an object with include and/or exclude globs.
 *
 * Note that dotfiles are excluded by default, and must be explicity added to an 'include' glob pattern.
 * in order to be included.
 */
export type GlobConfig =
  | string[]
  | {
      /**
       * Globs of files that should be included.
       *
       * @default ['**\/*']
       */
      include?: string[]
      /**
       * Globs of files that should be excluded.
       *
       * @default []
       */
      exclude?: string[]
    }

export interface CacheConfig {
  /**
   * Globs of files that this script depends on.
   *
   * If none are specified, all files in the package will be used.
   */
  inputs?: GlobConfig
  /**
   * Globs of files that this script produces.
   *
   * If none are specified, none will be tracked.
   */
  outputs?: GlobConfig
  /**
   * The names of any environment variables that should contribute to the cache key of this script.
   * Note that it will not control which env vars are passed to the script in any way.
   */
  envInputs?: string[]
}

export interface DependentCacheConfig extends CacheConfig {
  /**
   * If this script is not independent, this controls whether or not the output created by
   * upstream packages running this script counts towards the input for the current package.
   *
   * @default true
   */
  usesOutputFromDependencies?: boolean
  /**
   * If this script is not independent, this controls whether or not the inputs used by
   * upstream packages running this script count towards the input for the current package.
   *
   * @default true
   */
  inheritsInputFromDependencies?: boolean
}

export type RunsAfter = {
  /**
   * Whether or not this script uses the files created by the named script.
   * If true, they will be included as cache inputs.
   *
   * @default true
   */
  usesOutput?: boolean
  /**
   * Whether or not the input files of the named script should contribute to the
   * cache inputs of this script.
   *
   * @default false
   */
  inheritsInput?: boolean

  /**
   * Which packages to wait for the specified script to execute in.
   *
   * "all-packages" (default) - it will wait for the specified script to execute in all packages that implement the script.
   *
   * "self-and-dependencies" - it will wait for the script to execute in all packages that are dependencies of the current package, and the current package itself.
   *
   * "self-only" - it will wait for the specified script to complete in the current package only.
   *
   * @default 'all-packages'
   */
  in?: 'all-packages' | 'self-and-dependencies' | 'self-only'
}

export interface TopLevelScript {
  /**
   * The execution strategy for this script
   *
   * "dependent" (default)
   *
   *   The script will run in workspace package directories. It will run in topological order based
   *   on the dependencies listed in package.json files.
   *
   *   Any tasks that do not depend on each other may be run in parallel, unless specified otherwise.
   *
   * "independent"
   *
   *   The script will run in workspace package directories, in parallel tasks unless specified otherwise.
   *
   * "top-level"
   *
   *   The script will run in the root directory of the repo.
   *   You must specify a command to run.
   *   You may also want to add a `package.json` script with the same name that calls `lazy`.
   *
   * @default 'dependent'
   */
  execution: 'top-level'
  /**
   * The command to run for this script
   */
  baseCommand: string

  /** The other commands that must be completed before this one can run. */
  runsAfter?: {
    [scriptName: string]: RunsAfter
  }

  /**
   * The configuration for the input + output caches.
   *
   * Set to `"none"` to disable caching and make sure the task will always execute when invoked.
   *
   * @default { inputs: ["**\/*"] }
   */
  cache?: 'none' | CacheConfig
}

export interface DependentScript {
  /**
   * The execution strategy for this script
   *
   * "dependent" (default)
   *
   *   The script will run in workspace package directories. It will run in topological order based
   *   on the dependencies listed in package.json files.
   *
   *   Any tasks that do not depend on each other may be run in parallel, unless specified otherwise.
   *
   * "independent"
   *
   *   The script will run in workspace package directories, in parallel tasks unless specified otherwise.
   *
   * "top-level"
   *
   *   The script will run in the root directory of the repo.
   *   You must specify a command to run.
   *   You may also want to add a `package.json` script with the same name that calls `lazy`.
   *
   * @default 'dependent'
   */
  execution?: 'dependent'
  /**
   * The command to run for this script when invoked via `lazy inherit`
   */
  baseCommand?: string
  /**
   * Override the script configuration for specific workspaces.
   */
  workspaceOverrides?: {
    [dirGlob: string]: {
      baseCommand?: string
      cache?: 'none' | DependentCacheConfig
      runsAfter?: {
        [scriptName: string]: RunsAfter
      }
    }
  }
  /** The other commands that must be completed before this one can run. */
  runsAfter?: {
    [scriptName: string]: RunsAfter
  }
  /**
   * Whether this task can be safely executed in parallel with other instances of the same task.
   *
   * @default true
   */
  parallel?: boolean
  /**
   * The configuration for the input + output caches.
   *
   * Set to `"none"` to disable caching and make sure the task will always execute when invoked.
   *
   * @default { inputs: ["**\/*"] }
   */
  cache?: 'none' | DependentCacheConfig
}

export interface IndependentScript {
  /**
   * The execution strategy for this script
   *
   * "dependent" (default)
   *
   *   The script will run in workspace package directories. It will run in topological order based
   *   on the dependencies listed in package.json files.
   *
   *   Any tasks that do not depend on each other may be run in parallel, unless specified otherwise.
   *
   * "independent"
   *
   *   The script will run in workspace package directories, in parallel tasks unless specified otherwise.
   *
   * "top-level"
   *
   *   The script will run in the root directory of the repo.
   *   You must specify a command to run.
   *   You may also want to add a `package.json` script with the same name that calls `lazy`.
   *
   * @default 'dependent'
   */
  execution: 'independent'
  /**
   * The command to run for this script when invoked via `lazy inherit`
   */
  baseCommand?: string
  /**
   * Override the script configuration for specific workspaces.
   */
  workspaceOverrides?: {
    [dirGlob: string]: {
      baseCommand?: string
      cache?: 'none' | CacheConfig
      runsAfter?: {
        [scriptName: string]: RunsAfter
      }
    }
  }
  /** The other commands that must be completed before this one can run. */
  runsAfter?: {
    [scriptName: string]: RunsAfter
  }
  /**
   * Whether this task can be safely executed in parallel with other instances of the same task.
   *
   * @default true
   */
  parallel?: boolean
  /**
   * The configuration for the input + output caches.
   *
   * Set to `"none"` to disable caching and make sure the task will always execute when invoked.
   *
   * @default { inputs: ["**\/*"] }
   */
  cache?: 'none' | CacheConfig
}

export type LazyScript = TopLevelScript | DependentScript | IndependentScript

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
     *
     * Note also that dotfiles are excluded by default, and must be explicity added to an 'include' glob pattern.
     * in order to be included.
     */
    include?: string[]
    /**
     * Globs of files that should be excluded from every task's input manifest.
     *
     * Note that these glob patterns are evaluated in the task's directory, which is usually not the workspace root directory.
     * If you want to specify a glob pattern that is relative to the root, prefix the pattern with `<rootDir>/`.
     */
    exclude?: string[]
    /**
     * The names of any environment variables that should be included in every task's input manifest.
     */
    envInputs?: string[]
  }
  /**
   * Custom configuration for any scripts defined in your package.json "scripts" entries.
   */
  scripts?: { [scriptName: string]: LazyScript }
  /**
   * Ignore workspaces matching the given globs. No tasks will be scheduled to run in these workspaces, ever!
   *
   * Warning! This will be true even if another workspace lists one of the ignored workspaces as a dependency.
   */
  ignoreWorkspaces?: string[]
}
