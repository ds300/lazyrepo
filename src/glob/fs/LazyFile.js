import { basename } from 'path'

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
    this.name = basename(path)
    this.isSymbolicLink = isSymbolicLink
  }
}
