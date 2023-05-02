import { z } from 'zod'
import { formatZodError } from '../formatZodError.js'
import { logger } from '../logger/logger.js'

/** @type {z.ZodType<import('./config-types.js').GlobConfig>} */
export const globConfigSchema = z.union([
  z.array(z.string()),
  z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .strict(),
])

export const _cacheConfigSchema = z
  .object({
    inputs: globConfigSchema.optional(),
    outputs: globConfigSchema.optional(),
    envInputs: z.array(z.string()).optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').CacheConfig>} */
const cacheConfigSchema = _cacheConfigSchema

/** @type {z.ZodType<import('./config-types.js').DependentCacheConfig>} */
export const dependentCacheConfigSchema = _cacheConfigSchema
  .extend({
    usesOutputFromDependencies: z.boolean().optional(),
    inheritsInputFromDependencies: z.boolean().optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').RunsAfter>} */
const runsAfterSchema = z
  .object({
    usesOutput: z.boolean().optional(),
    inheritsInput: z.boolean().optional(),
    in: z
      .union([
        z.literal('all-packages'),
        z.literal('self-and-dependencies'),
        z.literal('self-only'),
      ])
      .optional(),
  })
  .strict()

const logMode = z.union([
  z.literal('full'),
  z.literal('new-only'),
  z.literal('errors-only'),
  z.literal('none'),
])

/** @type {z.ZodType<import('./config-types.js').TopLevelScript>} */
export const topLevelScriptSchema = z
  .object({
    execution: z.literal('top-level'),
    baseCommand: z.string(),
    cache: z.union([z.literal('none'), cacheConfigSchema]).optional(),
    runsAfter: z.record(runsAfterSchema).optional(),
    logMode: logMode.optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').DependentScript>} */
export const dependentScriptSchema = z
  .object({
    execution: z.literal('dependent').optional(),
    baseCommand: z.string().optional(),
    cache: z.union([z.literal('none'), dependentCacheConfigSchema]).optional(),
    parallel: z.boolean().optional(),
    runsAfter: z.record(runsAfterSchema).optional(),
    workspaceOverrides: z
      .record(
        z
          .object({
            logMode: logMode.optional(),
            baseCommand: z.string().optional(),
            cache: z.union([z.literal('none'), dependentCacheConfigSchema]).optional(),
            runsAfter: z.record(runsAfterSchema).optional(),
          })
          .strict(),
      )
      .optional(),
    logMode: logMode.optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').IndependentScript>} */
export const independentScriptSchema = z
  .object({
    execution: z.literal('independent'),
    baseCommand: z.string().optional(),
    cache: z.union([z.literal('none'), cacheConfigSchema]).optional(),
    parallel: z.boolean().optional(),
    runsAfter: z.record(runsAfterSchema).optional(),
    workspaceOverrides: z
      .record(
        z
          .object({
            logMode: logMode.optional(),
            baseCommand: z.string().optional(),
            cache: z.union([z.literal('none'), cacheConfigSchema]).optional(),
            runsAfter: z.record(runsAfterSchema).optional(),
          })
          .strict(),
      )
      .optional(),
    logMode: logMode.optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').LazyScript>} */
export const lazyScriptSchema = z.union([
  topLevelScriptSchema,
  dependentScriptSchema,
  independentScriptSchema,
])

/** @type {z.ZodType<import('./config-types.js').LazyConfig>} */
export const lazyConfigSchema = z
  .object({
    baseCacheConfig: z
      .object({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
        envInputs: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    scripts: z.record(lazyScriptSchema).optional(),
    tasks: z.record(lazyScriptSchema).optional(),
    ignoreWorkspaces: z.array(z.string()).optional(),
  })
  .strict()

/**
 * @param {import('./resolveConfig.js').LoadedConfig} config
 * @returns {import('./config-types.js').LazyConfig}
 */
export function validateConfig(config) {
  try {
    const res = lazyConfigSchema.parse(config)

    if ('tasks' in res) {
      logger.warn(`The "tasks" property is deprecated. Please use "scripts" instead.`)
      // @ts-expect-error
      res.scripts = res.tasks
    }

    return res
  } catch (err) {
    if (err instanceof z.ZodError) {
      const validationError = formatZodError(err)
      throw new Error(validationError.message)
    }
    throw err
  }
}
