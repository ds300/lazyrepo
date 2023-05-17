export class LazyFile {
  /**
   * @type {string}
   * @readonly
   */
  path
  /**
   * @type {boolean}
   * @readonly
   */
  isSymbolicLink
  /**
   * @type {string}
   * @readonly
   */
  name

  /**
   * @param {string} path
   * @param {boolean} isSymbolicLink
   * @param {import('./LazyDir.js').LazyDir} parentDir
   */
  constructor(path, isSymbolicLink, parentDir) {
    this.path = path
    this.name = path.slice(path.lastIndexOf('/') + 1)
    this.isSymbolicLink = isSymbolicLink
    this.parentDir = parentDir
  }
}
