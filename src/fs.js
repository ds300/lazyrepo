/**
 * This file is a wrapper around Node's fs module.
 *
 * This makes it easier to mock out the fs module for tests without messing up stuff like jest snapshots
 * and our own tooling that needs to use the actual fs module.
 */

// eslint-disable-next-line no-restricted-imports, n/no-deprecated-api
export * from 'fs'
