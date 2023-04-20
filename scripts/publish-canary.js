/* eslint-disable no-console */
import pkg from '@auto-it/core'

const { Auto } = pkg

const auto = new Auto({
  plugins: ['npm'],
  baseBranch: 'main',
  owner: 'ds300',
  repo: 'lazyrepo',
  verbose: true,
})

import { parse } from 'semver'
import { pathToFileURL } from 'url'
import { exec } from './lib/exec.js'
/**
 * @param {import('semver').ReleaseType} bump
 */
function getNextVersion(bump) {
  const currentVersion = parse(exec('pnpm view . version'))
  const gitSha = exec('git rev-parse --short HEAD')
  if (!currentVersion) {
    throw new Error('Could not parse current version')
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const nextVersion = currentVersion.prerelease.length
    ? // if the package is in prerelease mode, we want to release a canary for the current version rather than bumping
      currentVersion
    : currentVersion?.inc(bump)
  const versionString = `${nextVersion.major}.${nextVersion.minor}.${nextVersion.patch}-canary.${gitSha}`
  return versionString
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // module was called directly
  await auto.loadConfig()
  const bumpType = await auto.getVersion()

  console.log('bumpType: ' + JSON.stringify(bumpType))
  if (!bumpType) {
    console.log('No changes, skipping publish')
  } else if (['major', 'minor', 'patch'].includes(bumpType)) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const nextVersion = getNextVersion(bumpType)
    console.log('nextVersion: ' + nextVersion)

    const npmToken = process.env.NPM_TOKEN
    if (!npmToken) {
      throw new Error('NPM_TOKEN not set')
    }

    // set npm token and registry
    exec(`npm config set //registry.npmjs.org/:_authToken ${npmToken}`)
    exec(`npm config set registry https://registry.npmjs.org/`)
    exec(`npm whoami`)

    exec(`npm version ${nextVersion} --no-git-tag-version`)
    // exec(`npm publish --tag canary --access public`)
  } else {
    throw new Error('Invalid bump type provided')
  }
}
