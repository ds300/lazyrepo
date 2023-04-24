import { z } from 'zod'
import { formatZodError } from '../formatZodError.js'

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

const baseTaskSchema = z
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

/** @type {z.ZodType<import('./config-types.js').TopLevelTask>} */
export const topLevelTaskSchema = baseTaskSchema
  .extend({
    execution: z.literal('top-level'),
    baseCommand: z.string(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').PackageLevelTask>} */
export const packageLevelTaskSchema = baseTaskSchema
  .extend({
    execution: z.union([z.literal('dependent'), z.literal('independent')]).optional(),
    baseCommand: z.string().optional(),
  })
  .strict()

/** @type {z.ZodType<import('./config-types.js').LazyTask>} */
export const lazyTaskSchema = z.union([topLevelTaskSchema, packageLevelTaskSchema])

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
    tasks: z.record(lazyTaskSchema).optional(),
    ignoreWorkspaces: z.array(z.string()).optional(),
  })
  .strict()

/**
 * @param {import('./resolveConfig.js').LoadedConfig} config
 * @returns {import('./config-types.js').LazyConfig}
 */
export function validateConfig(config) {
  try {
    return lazyConfigSchema.parse(config)
  } catch (err) {
    if (err instanceof z.ZodError) {
      const validationError = formatZodError(err)
      throw new Error(validationError.message)
    }
    throw err
  }
}
