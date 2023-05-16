export class SortedArraySet {
  /** @type {string[]} */
  array = []

  /**
   * @param {string} value
   */
  push(value) {
    if (this.array.length === 0) {
      this.array.push(value)
      return
    }
    const comparison = value.localeCompare(this.array[this.array.length - 1])
    if (comparison === 0) return
    if (comparison > 0) {
      this.array.push(value)
      return
    }
    // TODO: binary search
    for (let i = this.array.length - 2; i >= 0; i--) {
      const comparison = value.localeCompare(this.array[i])
      if (comparison === 0) return
      if (comparison > 0) {
        this.array.splice(i + 1, 0, value)
        return
      }
    }

    this.array.unshift(value)
  }
}
