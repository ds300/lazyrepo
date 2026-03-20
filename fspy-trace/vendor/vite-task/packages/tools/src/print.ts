#!/usr/bin/env node

// Simple tool that prints arguments, like echo
// Used for testing caching behavior since built-in echo is not cached
const args = process.argv.slice(2);
console.log(args.join(' '));
