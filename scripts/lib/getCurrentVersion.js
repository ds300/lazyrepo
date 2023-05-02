import manifest from '../../package.json' assert { type: 'json' }

/**
 * @returns {string}
 */
export const getCurrentVersion = () => {
  return manifest.version
}
