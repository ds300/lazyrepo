// Adapted from go-rainbow
// Copyright (c) 2017 Raphael Amorim
// Source: https://github.com/raphamorim/go-rainbow

// SPDX-License-Identifier: MIT
function rgb(i: number): [number, number, number] {
	const f = 0.345

	return [
		Math.floor(Math.sin(f * i + (4 * Math.PI) / 3) * 127 + 128),
		45,
		Math.floor(Math.sin(f * i + 0) * 127 + 128),
	]
}

const char = (c: string, [r, g, b]: readonly [number, number, number]): string =>
	`\x1b[1m\x1b[38;2;${r};${g};${b}m${c}\x1b[0m\x1b[0;1m`

export function rainbow(text: string): string {
	let rainbowStr = ''

	let i = 0
	for (let c of text) {
		if (c === ' ') {
			rainbowStr += c
		} else {
			rainbowStr += char(c, rgb(i))
			i++
		}
	}

	return rainbowStr
}
