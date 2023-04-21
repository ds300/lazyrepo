import manifest from '../../package.json' assert { type: 'json' }

/**
 * @returns {string}
 */
export const getCurrentVersion = () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return manifest.version
}
