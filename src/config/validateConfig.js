import { z } from 'zod'

export const globConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  }),
])

export const cacheConfigSchema = z.union([
  z.literal('none'),
  z.object({
    inputs: globConfigSchema.optional(),
    outputs: globConfigSchema.optional(),
    envInputs: z.array(z.string()).optional(),
    usesOutputFromDependencies: z.boolean().optional(),
    inheritsInputFromDependencies: z.boolean().optional(),
  }),
])

const baseTaskConfigSchema = z.object({
  runsAfter: z
    .record(
      z.object({
        usesOutput: z.boolean().optional(),
        inheritsInput: z.boolean().optional(),
      }),
    )
    .optional(),
  cache: cacheConfigSchema.optional(),
  parallel: z.boolean().optional(),
})

export const topLevelTaskConfigSchema = baseTaskConfigSchema.extend({
  runType: z.literal('top-level'),
  baseCommand: z.string(),
})

export const packageLevelTaskConfigSchema = baseTaskConfigSchema.extend({
  runType: z.union([z.literal('dependent'), z.literal('independent')]).optional(),
  baseCommand: z.string().optional(),
})

export const taskConfigSchema = z.union([topLevelTaskConfigSchema, packageLevelTaskConfigSchema])

export const lazyConfigSchema = z
  .object({
    baseCacheConfig: z
      .object({
        includes: z.array(z.string()).optional(),
        excludes: z.array(z.string()).optional(),
        envInputs: z.array(z.string()).optional(),
      })
      .optional(),
    tasks: z.record(taskConfigSchema).optional(),
  })
  .strict()

/**
 * @param {Object<*,*>} config
 * @returns {z.infer<typeof lazyConfigSchema>}
 */
export function validateConfig(config) {
  return lazyConfigSchema.parse(config)
}
