#!/usr/bin/env node

// Cross-platform cat replacement: reads all of stdin and writes it to stdout.
// Unlike MSYS cat on Windows, this handles Stdio::null() gracefully by
// receiving an immediate EOF rather than crashing.
process.stdin.pipe(process.stdout);
