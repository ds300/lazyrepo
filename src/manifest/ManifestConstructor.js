import { createHash } from 'crypto'

import { open, writeFile } from '../fs.js'
import { readIfExists } from '../readIfExists.js'
import { unlinkIfExists } from '../unlinkIfExists.js'
import { compareManifestTypes } from './computeManifest.js'

const TAB = '\t'
const LF = '\n'

const SAME_AS_BEFORE = 'SAME_AS_BEFORE'
const PREV_WAS_DELETED = 'PREV_WAS_DELETED'
const WAS_ADDED = 'WAS_ADDED'
const WAS_CHANGED = 'WAS_CHANGED'

/**
 * @typedef {typeof SAME_AS_BEFORE | typeof PREV_WAS_DELETED | typeof WAS_ADDED | typeof WAS_CHANGED} ManifestLineComparison
 */

/**
 * @typedef {Object} Writable
 * @property {(chunk: string) => void} write
 * @property {() => void} end
 */

/**
 * @typedef {Object} ManifestConstructorProps
 *
 * @property {string} previousManifestPath
 * @property {string} nextManifestPath
 * @property {string} diffPath
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
   * @readonly
   * @type {string}
   */
  nextManifestPath

  /**
   * @private
   * @readonly
   * @type {string}
   */
  diffPath

  /**
   * @private
   * @param {string | null} previousManifestSource
   * @param {string} diffPath
   * @param {string} nextManifestPath
   */
  constructor(previousManifestSource, diffPath, nextManifestPath) {
    this.previousManifestSource = previousManifestSource
    this.nextManifestPath = nextManifestPath
    this.diffPath = diffPath
  }

  /**
   * @param {ManifestConstructorProps} options
   */
  static async from({ previousManifestPath, diffPath, nextManifestPath }) {
    const previousManifestSource = await readIfExists(previousManifestPath)
    return new ManifestConstructor(previousManifestSource, diffPath, nextManifestPath)
  }

  /** @private */
  lineOffset = 0

  /**
   * @private
   * @type {import('fs').WriteStream | null}
   */
  _manifestOutStream = null

  /**
   * @private
   * @type {import('fs').WriteStream | null}
   */
  _diffOutStream = null

  /** @private */
  prevType = ''
  /** @private */
  prevId = ''

  /**
   * @param {string} type
   * @param {string} id
   * @param {string} meta
   * @returns {boolean}
   */
  copyLineOverIfMetaIsSame(type, id, meta) {
    if (type !== this.prevType && compareManifestTypes(type, this.prevType) < 0) {
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
      if (this._manifestOutStream) {
        // only write if we have written before. otherwise it will catch up later if needed
        this._manifestOutStream.write(line + LF)
      }
      this.lineOffset = nextLineOffset + 1
      this.prevId = id
      this.prevType = type
      return true
    } else {
      return false
    }
  }

  async getManifestOutStream() {
    if (this._manifestOutStream === null) {
      this._manifestOutStream = (await open(this.nextManifestPath, 'w')).createWriteStream({
        encoding: 'utf-8',
      })
      if (this.previousManifestSource) {
        // catch up
        this._manifestOutStream.write(this.previousManifestSource.slice(0, this.lineOffset))
      }
    }
    return this._manifestOutStream
  }

  async getDiffOutStream() {
    if (this._diffOutStream === null) {
      // TODO: do we need to unlink this first?
      this._diffOutStream = (await open(this.diffPath, 'w')).createWriteStream({
        encoding: 'utf-8',
      })
    }
    return this._diffOutStream
  }

  /**
   * @private
   * @param {string} type
   * @param {string} id
   * @param {string} hash
   *
   * @returns {Promise<ManifestLineComparison | null>}
   */
  async compareWithPreviousLine(type, id, hash) {
    if (this.previousManifestSource === null) {
      return null
    }

    const nextLineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)
    if (nextLineOffset === -1) {
      // if it comes before, that means it wasn't there in the previous one
      ;(await this.getDiffOutStream()).write('+ added ' + type + ' ' + id + LF)
      return WAS_ADDED
    }
    const line = this.previousManifestSource.slice(this.lineOffset, nextLineOffset)

    const parts = line.split(TAB)

    if (parts[0] !== type) {
      // unexpected new type, so the previous one was removed
      const comesBeforePrevious = compareManifestTypes(type, parts[0]) < 0
      if (comesBeforePrevious) {
        // if it comes before, that means it wasn't there in the previous one
        ;(await this.getDiffOutStream()).write('+ added ' + type + ' ' + id + LF)
        return WAS_ADDED
      } else {
        ;(await this.getDiffOutStream()).write('- removed ' + type + ' ' + id + LF)
        return PREV_WAS_DELETED
      }
    }
    // types are the same, so check id
    if (parts[1] !== id) {
      // id changed unexpectedly, should it be before or after than the previous one?
      const comesBeforePrevious = parts[1] > id

      if (comesBeforePrevious) {
        // if it comes before, that means it wasn't there in the previous one
        ;(await this.getDiffOutStream()).write('+ added ' + type + ' ' + id + LF)
        return WAS_ADDED
      } else {
        // if it comes after, that means the previous one was deleted
        ;(await this.getDiffOutStream()).write('- removed ' + type + ' ' + parts[1] + LF)
        return PREV_WAS_DELETED
      }
    }
    // types and ids are the same, so check hash

    if (hash !== parts[2]) {
      // hash changed
      ;(await this.getDiffOutStream()).write('± changed ' + type + ' ' + id + LF)
      return WAS_CHANGED
    }

    return SAME_AS_BEFORE
  }

  /**
   *
   * @param {string} type
   * @param {string} id
   * @param {string} hash
   * @param {string} [meta]
   */
  async update(type, id, hash, meta) {
    if (type !== this.prevType && compareManifestTypes(type, this.prevType) < 0) {
      throw new Error(`Invalid type order: ${type} < ${this.prevType}`)
    }
    if (type === this.prevType && id < this.prevId) {
      throw new Error(`Invalid id order: ${id} < ${this.prevId}`)
    }

    let comparisonResult = null
    if (this.previousManifestSource !== null) {
      comparisonResult = await this.compareWithPreviousLine(type, id, hash)
      while (comparisonResult === PREV_WAS_DELETED) {
        // make sure the manifest stream is started so it can catch up
        await this.getManifestOutStream()
        this.lineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1) + 1
        comparisonResult = this.compareWithPreviousLine(type, id, hash)
      }
    }

    this.globalHash.update(type)
    this.globalHash.update(id)
    this.globalHash.update(hash)

    if (this._manifestOutStream || comparisonResult !== SAME_AS_BEFORE) {
      ;(await this.getManifestOutStream()).write(
        type + TAB + id + TAB + hash + (meta ? TAB + meta + LF : LF),
      )
    }

    if (this.previousManifestSource && comparisonResult !== WAS_ADDED) {
      // if it was added, we don't need to advance the line offset
      this.lineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1) + 1
    }

    this.prevType = type
    this.prevId = id
  }

  async end() {
    if (
      this.previousManifestSource !== null &&
      this.lineOffset < this.previousManifestSource.length - 1
    ) {
      if (!this._manifestOutStream) {
        if (this.lineOffset === 0) {
          // manifest was previously not empty and is now empty, need to create an empty file
          await writeFile(this.nextManifestPath, '')
        } else {
          // need to catch up
          await this.getManifestOutStream()
        }
      }

      while (this.lineOffset < this.previousManifestSource.length - 1) {
        const nextLineOffset = this.previousManifestSource.indexOf(LF, this.lineOffset + 1)

        const [type, id] = this.previousManifestSource
          .slice(this.lineOffset, nextLineOffset)
          .split(TAB)

        ;(await this.getDiffOutStream()).write(`- removed ${type} ${id}${LF}`)

        if (nextLineOffset === -1) {
          break
        } else {
          this.lineOffset = nextLineOffset + 1
        }
      }
    }
    // unlink previous diff if no changes
    if (!this._diffOutStream) {
      await unlinkIfExists(this.diffPath)
    }
    if (!this._manifestOutStream && this.previousManifestSource === null) {
      // no manifest previously existed and there were no updates so we need to create an empty file
      await writeFile(this.nextManifestPath, '')
    }
    await Promise.all([close(this._diffOutStream), close(this._manifestOutStream)])

    const didChange = !!this._diffOutStream || this.previousManifestSource === null
    return { hash: this.globalHash.digest('hex'), didChange }
  }
}

/**
 * @param {import('fs').WriteStream | null} stream
 */
function close(stream) {
  return new Promise((resolve, reject) => {
    if (stream === null) {
      resolve(null)
    } else {
      stream.on('close', resolve)
      stream.on('error', reject)
      stream.close()
    }
  })
}
