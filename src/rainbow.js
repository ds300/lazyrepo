// Adapted from go-rainbow
// Copyright (c) 2017 Raphael Amorim
// Source: https://github.com/raphamorim/go-rainbow

import { isatty } from 'tty'

// SPDX-License-Identifier: MIT
/**
 * @param {number} i
 * @returns {[number, number, number]}
 */
function rgb(i) {
  const f = 0.285

  return [
    Math.floor(Math.sin(f * i + (4 * Math.PI) / 3) * 127 + 128),
    45,
    Math.floor(Math.sin(f * i + 0) * 127 + 128),
  ]
}

/**
 * @param {string} c
 * @param {[number, number, number]} param1
 * @returns {string}
 */
const char = (c, [r, g, b]) => `\x1b[1m\x1b[38;2;${r};${g};${b}m${c}\x1b[0m\x1b[0;1m\x1b[0m`

/**
 * @param {string} text
 * @returns {string}
 */
export function rainbow(text) {
  if (!isatty(process.stdout.fd)) {
    return text
  }
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
