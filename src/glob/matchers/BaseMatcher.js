export class BaseMatcher {
  /** @type {Matcher[]} */
  children = []

  /**
   * @type {boolean}
   * @readonly
   */
  negating

  /**
   * @param {boolean} negating
   */
  constructor(negating) {
    this.negating = negating
  }
}
