export class SortedArraySet {
  /** @type {string[]} */
  arr = []

  /**
   * @param {string} value
   */
  push(value) {
    if (this.arr.length === 0) {
      this.arr.push(value)
      return
    }
    const comparison = value.localeCompare(this.arr[this.arr.length - 1])
    if (comparison === 0) return
    if (comparison > 0) {
      this.arr.push(value)
      return
    }
    // TODO: binary search
    for (let i = this.arr.length - 2; i >= 0; i--) {
      const comparison = value.localeCompare(this.arr[i])
      if (comparison === 0) return
      if (comparison > 0) {
        this.arr.splice(i + 1, 0, value)
        return
      }
    }

    this.arr.unshift(value)
  }
}
