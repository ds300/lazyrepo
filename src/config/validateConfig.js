import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'
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

/** @type {z.ZodType<import('./config-types.js').CacheConfig>} */
export const cacheConfigSchema = z
  .object({
    inputs: globConfigSchema.optional(),
    outputs: globConfigSchema.optional(),
    envInputs: z.array(z.string()).optional(),
    usesOutputFromDependencies: z.boolean().optional(),
    inheritsInputFromDependencies: z.boolean().optional(),
  })
  .strict()

const baseScriptSchema = z
  .object({
    runsAfter: z
      .record(
        z
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
          .strict(),
      )
      .optional(),
    cache: z.union([z.literal('none'), cacheConfigSchema]).optional(),
    parallel: z.boolean().optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').TopLevelScript>} */
export const topLevelScriptSchema = baseScriptSchema
  .extend({
    execution: z.literal('top-level'),
    baseCommand: z.string(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').PackageLevelScript>} */
export const packageLevelScriptSchema = baseScriptSchema
  .extend({
    execution: z.union([z.literal('dependent'), z.literal('independent')]).optional(),
    baseCommand: z.string().optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').LazyScript>} */
export const lazyScriptSchema = z.union([topLevelScriptSchema, packageLevelScriptSchema])

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
      const validationError = fromZodError(err, {
        issueSeparator: '\n',
        prefix: '',
        prefixSeparator: '',
      })
      throw new Error(validationError.message)
    }
    throw err
  }
}
