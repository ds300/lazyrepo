import crypto from 'crypto'
import { closeSync, openSync, readSync } from '../fs.js'

const bufferSize = 1024

const buffer = Buffer.alloc(bufferSize)

/**
 *
 * @param {string} filePath
 * @param {number} fileSize
 * @returns
 */
export function hashFile(filePath, fileSize) {
  const sha = crypto.createHash('sha256')
  const fileDescriptor = openSync(filePath, 'r')
  let totalBytesRead = 0
  while (totalBytesRead < fileSize) {
    const bytesRead = readSync(
      fileDescriptor,
      buffer,
      0,
      Math.min(fileSize - totalBytesRead, bufferSize),
      totalBytesRead,
    )
    if (bytesRead < bufferSize) {
      sha.update(buffer.slice(0, bytesRead))
    } else {
      sha.update(buffer)
    }
    totalBytesRead += bytesRead
  }
  closeSync(fileDescriptor)
  return sha.digest('hex')
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
