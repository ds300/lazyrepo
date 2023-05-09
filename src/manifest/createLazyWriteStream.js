import { createWriteStream, mkdirSync } from '../fs.js'
import { dirname } from '../path.js'

// A little wrapper around createWriteStream that returns a Promise when the stream is closed.
class LazyWriteStream {
  /** @param {string} path */
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true })
    this.stream = createWriteStream(path, 'utf-8')
  }

  /** @param {string} data */
  write(data) {
    this.stream.write(data)
  }

  close() {
    return new Promise((res) => {
      this.stream.end()
      this.stream.close(() => {
        res(null)
      })
    })
  }
}

/**
 * @param {string} path
 * @returns {import('./manifest-types.js').LazyWriter}
 */
export function createLazyWriteStream(path) {
  return new LazyWriteStream(path)
}
