#!/usr/bin/env node
// Prints the value of an environment variable
const varName = process.argv[2];
if (!varName) {
  console.error('Usage: print-env <VAR_NAME>');
  process.exit(1);
}
console.log(process.env[varName] ?? '(undefined)');
