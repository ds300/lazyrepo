import { createHash } from 'crypto'

const TAB = '\t'
const LF = '\n'

/**
 * @typedef {Object} ComputeManifestArgs
 *
 * @property {string} cwd
 * @property {import("../types.js").ScheduledTask} task
 */

/**
 * @param {ComputeManifestArgs} args
 */
export function computeManifest(args) {}

/**
 * @typedef {Object} Writable
 * @property {(chunk: string) => void} write
 * @property {() => void} end
 */

export class ManifestConstructor {
  globalHash = createHash('sha256')

  /**
   * @readonly
   * @private
   * @type {string | null}
   */
  previousManifestSource

  /**
   * @private
   */
  lineOffset = 0

  /**
   * @private
   * @type {Writable}
   */
  manifestOutStream

  /**
   * @private
   * @type {Writable | null}
   */
  diffOutStream

  /**
   * @param {string | null} previousManifestSource
   * @param {Writable} manifestOutStream
   * @param {Writable | null} diffOutStream
   */
  constructor(previousManifestSource, manifestOutStream, diffOutStream) {
    this.previousManifestSource = previousManifestSource
    this.manifestOutStream = manifestOutStream
    this.diffOutStream = diffOutStream
    if (!diffOutStream) {
      this.didChange = true
    }
  }

  /**
   * @private
   */
  didChange = false
  /**
   * @private
   */
  prevType = ''
  /**
   * @private
   */
  prevId = ''

  /**
   * @param {string} type
   * @param {string} id
   * @param {string} meta
   * @returns {boolean}
   */
  copyLineOverIfMetaIsSame(type, id, meta) {
    if (type < this.prevType) {
      throw new Error(`Invalid type order: ${type} < ${this.prevType}`)
    }
    if (type === this.prevType && id < this.prevId) {
      throw new Error(`Invalid id order: ${id} < ${this.prevId}`)
    }

    if (this.previousManifestSource === null) {
      return false
    }
    const nextLineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)
    const line = this.previousManifestSource.slice(this.lineOffset, nextLineOffset)

    const parts = line.split(TAB)

    if (parts[0] === type && parts[1] === id && parts[3] === meta) {
      this.globalHash.update(parts[0])
      this.globalHash.update(parts[1])
      this.globalHash.update(parts[2])
      this.manifestOutStream.write(line + LF)
      this.lineOffset = nextLineOffset + 1
      this.prevId = id
      this.prevType = type
      return true
    } else {
      return false
    }
  }

  /**
   * @private
   * @param {string} type
   * @param {string} id
   * @param {string} hash
   */
  compareWithPreviousLine(type, id, hash) {
    if (this.previousManifestSource === null || this.diffOutStream === null) {
      return
    }

    const nextLineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)
    const line = this.previousManifestSource.slice(this.lineOffset, nextLineOffset)

    const parts = line.split(TAB)

    if (parts[0] !== type) {
      // unexpected new type, so the previous one was removed
      this.diffOutStream.write('- removed ' + type + ' ' + id + LF)
      return
    }
    // types are the same, so check id
    if (parts[1] !== id) {
      // id changed unexpectedly, should it be before or after than the previous one?
      const comesBeforePrevious = parts[1] > id

      if (comesBeforePrevious) {
        // if it comes before, that means it wasn't there in the previous one
        this.didChange = true
        this.diffOutStream.write('+ added ' + type + ' ' + id + LF)
      } else {
        // if it comes after, that means the previous one was deleted
        this.didChange = true
        this.diffOutStream.write('- removed ' + type + ' ' + parts[1] + LF)
      }
      return
    }
    // types and ids are the same, so check hash

    if (hash !== parts[2]) {
      // hash changed
      this.didChange = true
      this.diffOutStream.write('± changed ' + type + ' ' + id + LF)
      return
    }
  }

  /**
   *
   * @param {string} type
   * @param {string} id
   * @param {string} hash
   * @param {string} [meta]
   */
  update(type, id, hash, meta) {
    if (type < this.prevType) {
      throw new Error(`Invalid type order: ${type} < ${this.prevType}`)
    }
    if (type === this.prevType && id < this.prevId) {
      throw new Error(`Invalid id order: ${id} < ${this.prevId}`)
    }

    if (this.previousManifestSource !== null && this.diffOutStream) {
      this.compareWithPreviousLine(type, id, hash)
      this.lineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1) + 1
    }

    this.globalHash.update(type)
    this.globalHash.update(id)
    this.globalHash.update(hash)
    this.manifestOutStream?.write(type + TAB + id + TAB + hash + (meta ? TAB + meta + LF : LF))

    this.prevType = type
    this.prevId = id
  }

  end() {
    if (this.diffOutStream !== null && this.previousManifestSource !== null) {
      while (this.lineOffset >= 0 && this.lineOffset < this.previousManifestSource.length - 1) {
        const nextLineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)

        const [type, id] = this.previousManifestSource
          .slice(this.lineOffset, nextLineOffset)
          .split(TAB)

        this.didChange = true
        this.diffOutStream.write(`- removed ${type} ${id}`)

        this.lineOffset = nextLineOffset + 1
      }
    }
    this.diffOutStream?.end()
    this.manifestOutStream.end()
    return { hash: this.globalHash.digest('hex'), didChange: this.didChange }
  }
}
