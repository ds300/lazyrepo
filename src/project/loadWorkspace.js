import path from 'path'
import yaml from 'yaml'
import { z } from 'zod'
import { fromZodError } from 'zod-validation-error'
import { readFileSync } from '../fs.js'
import { uniq } from '../uniq.js'

const packageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  workspaces: z.array(z.string()).optional(),
  scripts: z.record(z.string()).default({}),
  dependencies: z.record(z.string()).default({}),
  devDependencies: z.record(z.string()).default({}),
  peerDependencies: z.record(z.string()).default({}),
  optionalDependencies: z.record(z.string()).default({}),
})

const pnpmWorkspaceYamlSchema = z.object({
  packages: z.array(z.string()),
})

/** @typedef {z.infer<typeof packageJsonSchema>} PackageJson */
/** @typedef {z.infer<typeof pnpmWorkspaceYamlSchema>} PnpmWorkspaceYaml */

/**
 * @param {string} dir
 */
function readPackageJsonIfExists(dir) {
  const packageJsonPath = path.join(dir, 'package.json')
  let packageJsonString
  try {
    packageJsonString = readFileSync(packageJsonPath, 'utf8')
  } catch {
    return null
  }

  try {
    return packageJsonSchema.parse(JSON.parse(packageJsonString))
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

/**
 * @param {string} dir
 */
function readPnpmWorkspaceYamlIfExists(dir) {
  const pnpmWorkspaceYamlPath = path.join(dir, 'pnpm-workspace.yaml')
  let pnpmWorkspaceYamlString
  try {
    pnpmWorkspaceYamlString = readFileSync(pnpmWorkspaceYamlPath, 'utf8')
  } catch {
    return null
  }

  try {
    return pnpmWorkspaceYamlSchema.parse(yaml.parse(pnpmWorkspaceYamlString))
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

/**
 * @param {string} dir
 * @returns {import('./project-types.js').PartialWorkspace}
 */
export function loadWorkspace(dir) {
  const packageJson = readPackageJsonIfExists(dir)
  if (!packageJson) {
    throw new Error(`Could not find package.json in ${dir}`)
  }
  const pnpmWorkspaceYaml = readPnpmWorkspaceYamlIfExists(dir)
  if (packageJson.workspaces && pnpmWorkspaceYaml) {
    throw new Error(`Both pnpm-workspace.yaml and package.json workspaces are defined in ${dir}`)
  }
  return {
    dir,
    name: packageJson.name,
    scripts: packageJson.scripts,
    childWorkspaceGlobs: packageJson.workspaces ?? pnpmWorkspaceYaml?.packages ?? [],
    allDependencyNames: uniq([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {}),
      ...Object.keys(packageJson.optionalDependencies ?? {}),
    ]),
  }
}
