import { existsSync } from '../fs.js'
import { join } from '../path.js'

/**
 * @param {string} rootWorkspaceDir
 * @returns {import('./project-types.js').PackageManger | null}
 */
export function getPackageManager(rootWorkspaceDir) {
  if (existsSync(join(rootWorkspaceDir, 'pnpm-lock.yaml'))) {
    return 'pnpm'
  } else if (existsSync(join(rootWorkspaceDir, 'yarn.lock'))) {
    return 'yarn'
  } else if (existsSync(join(rootWorkspaceDir, '.yarnrc.yml'))) {
    return 'yarn'
  } else if (existsSync(join(rootWorkspaceDir, '.yarnrc'))) {
    return 'yarn'
  } else if (existsSync(join(rootWorkspaceDir, 'package-lock.json'))) {
    return 'npm'
  } else if (existsSync(join(rootWorkspaceDir, '.npmrc'))) {
    return 'npm'
  }
  return null
}
