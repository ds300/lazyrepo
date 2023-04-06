import crypto from 'crypto'
import fs from 'fs'

const bufferSize = 1024

const buffer = Buffer.alloc(bufferSize)

export function hashFile(filePath: string, fileSize: number) {
	const sha = crypto.createHash('sha256')
	const fileDescriptor = fs.openSync(filePath, 'r')
	let totalBytesRead = 0
	while (totalBytesRead < fileSize) {
		const bytesRead = fs.readSync(
			fileDescriptor,
			buffer,
			0,
			Math.min(fileSize - totalBytesRead, bufferSize),
			totalBytesRead
		)
		if (bytesRead < bufferSize) {
			sha.update(buffer.slice(0, bytesRead))
		} else {
			sha.update(buffer)
		}
		totalBytesRead += bytesRead
	}
	return sha.digest('hex')
}

export function hashString(string: string | Buffer) {
	const sha = crypto.createHash('sha256')
	sha.update(string)
	return sha.digest('hex')
}
