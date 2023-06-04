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
   */
  constructor(path, isSymbolicLink) {
    this.path = path
    this.name = path.slice(path.lastIndexOf('/') + 1)
    this.isSymbolicLink = isSymbolicLink
  }
}
