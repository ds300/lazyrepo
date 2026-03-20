#!/usr/bin/env node

// Opens a file once in read-write mode (O_RDWR) without modifying content.
// Used to test that fspy detects a single O_RDWR open as both READ and WRITE.

import { openSync, closeSync, constants } from 'node:fs';

const filename = process.argv[2];
if (!filename) {
  console.error('Usage: touch-file <filename>');
  process.exit(1);
}

const fd = openSync(filename, constants.O_RDWR);
closeSync(fd);
