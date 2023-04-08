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
   * @param {string} meta
   * @returns {boolean}
   */
  isMetaSameAsPreviously(meta) {
    if (this.previousManifestSource === null) {
      return false
    }
    const nextLineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)
    const idOffset = this.previousManifestSource.indexOf(TAB, this.lineOffset)
    const hashOffset = this.previousManifestSource.indexOf(TAB, idOffset + 1)
    const metaOffset = this.previousManifestSource.indexOf(TAB, hashOffset + 1)
    if (metaOffset === -1 || metaOffset > nextLineOffset) {
      return false
    }

    let i = 0
    while (i < meta.length && this.previousManifestSource[metaOffset + i] === meta[i]) {
      i++
    }

    if (i === meta.length && this.previousManifestSource[metaOffset + i] === LF) {
      return true
    }

    return false
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
    if (this.lineOffset === -1 || this.lineOffset >= this.previousManifestSource.length) {
      this.didChange = true
      this.diffOutStream.write('+ added\t' + type + TAB + id + LF)
      return
    }
    const typeOffset = this.lineOffset
    let typeIndex = 0
    while (
      typeIndex < type.length &&
      this.previousManifestSource[typeOffset + typeIndex] === type[typeIndex]
    ) {
      typeIndex++
    }
    if (typeIndex !== type.length || this.previousManifestSource[typeOffset + typeIndex] !== TAB) {
      // type changed unexpectedly, so the current one must have been deleted
      const firstTabIndex = this.previousManifestSource.indexOf(TAB, typeOffset)
      const secondTabIndex = this.previousManifestSource.indexOf(TAB, firstTabIndex + 1)
      this.didChange = true
      this.diffOutStream.write(
        '- removed\t' + this.previousManifestSource.slice(typeOffset, secondTabIndex) + LF,
      )
      return
    }
    // types are the same, so check id

    const idOffset = typeOffset + typeIndex + 1
    let idIndex = 0
    while (idIndex < id.length && this.previousManifestSource[idOffset + idIndex] === id[idIndex]) {
      idIndex++
    }

    if (idIndex !== id.length || this.previousManifestSource[idOffset + idIndex] !== TAB) {
      // id changed unexpectedly, should it be before or after than the previous one?
      const comesBeforePrevious = this.previousManifestSource[idOffset + idIndex] > id[idIndex]

      if (comesBeforePrevious) {
        // if it comes before, that means it wasn't there in the previous one
        this.didChange = true
        this.diffOutStream.write('+ added\t' + type + TAB + id + LF)
        return
      } else {
        // if it comes after, that means the previous one was deleted
        const endIndex = this.previousManifestSource.indexOf(TAB, idOffset)
        this.didChange = true
        this.diffOutStream.write(
          '- removed\t' + this.previousManifestSource.slice(typeOffset, endIndex) + LF,
        )
      }
    }

    // id is the same, so check hash

    const hashOffset = idOffset + idIndex + 1
    let hashIndex = 0
    while (
      hashIndex < hash.length &&
      this.previousManifestSource[hashOffset + hashIndex] === hash[hashIndex]
    ) {
      hashIndex++
    }

    const didEndOnControlChar =
      this.previousManifestSource[hashOffset + hashIndex] === TAB ||
      this.previousManifestSource[hashOffset + hashIndex] === LF

    if (hashIndex !== hash.length || !didEndOnControlChar) {
      // hash changed
      this.didChange = true
      this.diffOutStream.write('± changed\t' + type + TAB + id + LF)
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
    if (id < this.prevId) {
      throw new Error(`Invalid id order: ${id} < ${this.prevId}`)
    }

    if (this.previousManifestSource !== null && this.diffOutStream) {
      this.compareWithPreviousLine(type, id, hash)
      this.lineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)
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

        const idOffset = this.previousManifestSource.indexOf(TAB, this.lineOffset)
        const hashOffset = this.previousManifestSource.indexOf(TAB, idOffset + 1)

        this.didChange = true
        this.diffOutStream.write(
          `- removed\t${this.previousManifestSource.slice(this.lineOffset, hashOffset)}\n`,
        )

        this.lineOffset = nextLineOffset
      }
    }
    this.diffOutStream?.end()
    this.manifestOutStream.end()
    return { hash: this.globalHash.digest('hex'), didChange: this.didChange }
  }
}
