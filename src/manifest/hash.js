import crypto from 'crypto'
import { open } from '../fs.js'

const BUFFER_SIZE = 1024

class BufferCell {
  /**
   * @type {Buffer}
   */
  buffer
  /**
   * @type {BufferCell | null}
   */
  next

  constructor() {
    this.buffer = Buffer.alloc(BUFFER_SIZE)
    this.next = null
  }
}

/** @type {BufferCell | null} */
let availableBufferStack = null

function acquireBuffer() {
  if (availableBufferStack) {
    const buffer = availableBufferStack
    availableBufferStack = buffer.next
    buffer.next = null
    return buffer
  }
  return new BufferCell()
}

/**
 * @param {BufferCell} buffer
 */
function relinquishBuffer(buffer) {
  buffer.next = availableBufferStack
  availableBufferStack = buffer
}

/**
 *
 * @param {string} filePath
 * @param {number} fileSize
 * @returns
 */
export async function hashFile(filePath, fileSize) {
  const buffer = acquireBuffer()
  const file = await open(filePath, 'r')
  try {
    const sha = crypto.createHash('sha256')
    let totalBytesRead = 0
    while (totalBytesRead < fileSize) {
      const res = await file.read(
        buffer.buffer,
        0,
        Math.min(fileSize - totalBytesRead, BUFFER_SIZE),
        totalBytesRead,
      )

      if (res.bytesRead < BUFFER_SIZE) {
        sha.update(buffer.buffer.slice(0, res.bytesRead))
      } else {
        sha.update(buffer.buffer)
      }
      totalBytesRead += res.bytesRead
    }
    return sha.digest('hex')
  } finally {
    await file.close()
    relinquishBuffer(buffer)
  }
}

/**
 * @param {string | Buffer} string
 * @returns
 */
export function hashString(string) {
  const sha = crypto.createHash('sha256')
  sha.update(string)
  return sha.digest('hex')
}
