#!/usr/bin/env node

// Reports whether each stdio stream is connected to a TTY.
// Used to detect whether the task runner inherited stdio (TTY) or piped it.
//
// Output format:
//   stdin:tty  or  stdin:not-tty
//   stdout:tty or  stdout:not-tty
//   stderr:tty or  stderr:not-tty
const stdinTty = process.stdin.isTTY ? 'tty' : 'not-tty';
const stdoutTty = process.stdout.isTTY ? 'tty' : 'not-tty';
const stderrTty = process.stderr.isTTY ? 'tty' : 'not-tty';
console.log(`stdin:${stdinTty}`);
console.log(`stdout:${stdoutTty}`);
console.log(`stderr:${stderrTty}`);
