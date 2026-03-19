import manifest from '../../package.json' with { type: 'json' }

/**
 * @returns {string}
 */
export const getCurrentVersion = () => {
  return manifest.version
}
