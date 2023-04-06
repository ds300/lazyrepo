// Adapted from go-rainbow
// Copyright (c) 2017 Raphael Amorim
// Source: https://github.com/raphamorim/go-rainbow

// SPDX-License-Identifier: MIT
function rgb(i: number): [number, number, number] {
	const f = 0.275

	return [
		Math.floor(Math.sin(f * i + (4 * Math.PI) / 3) * 127 + 128),
		45,
		Math.floor(Math.sin(f * i + 0) * 127 + 128),
	]
}

// Adapted from go-rainbow
// Copyright (c) 2017 Raphael Amorim
// Source: https://github.com/raphamorim/go-rainbow
// SPDX-License-Identifier: MIT
export function rainbow(text: string): string {
	let rainbowStr = ''

	for (let i = 0; i < text.length; i++) {
		const [r, g, b] = rgb(i)
		const value = text[i]

		rainbowStr += `\x1b[1m\x1b[38;2;${r};${g};${b}m${value}\x1b[0m\x1b[0;1m`
	}

	return rainbowStr
}
