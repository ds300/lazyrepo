/* eslint-disable no-console */
import autopkg from '@auto-it/core'
import { parse } from 'semver'
import { pathToFileURL } from 'url'
import { exec } from './lib/exec.js'
import { getCurrentVersion } from './lib/getCurrentVersion.js'

const { Auto } = autopkg

const auto = new Auto({
  plugins: ['npm'],
  baseBranch: 'main',
  owner: 'ds300',
  repo: 'lazyrepo',
  verbose: true,
})

/**
 * @param {import('semver').ReleaseType} bump
 */
function getNextVersion(bump) {
  const currentVersion = parse(getCurrentVersion())
  if (!currentVersion) {
    throw new Error('Could not parse current version')
  }
  const [prereleaseTag, prereleaseNumber] = currentVersion.prerelease
  if (prereleaseTag && typeof prereleaseNumber !== 'number') {
    throw new Error(
      `Invalid prerelease format in version ${currentVersion}, expected e.g. -alpha.1`,
    )
  }
  const nextVersion = prereleaseTag
    ? // if the package is in prerelease mode, we want to release a prerelease for the current version rather than bumping
      `${currentVersion.major}.${currentVersion.minor}.${currentVersion.patch}-${prereleaseTag}.${
        Number(prereleaseNumber) + 1
      }`
    : currentVersion?.inc(bump).format()

  return { nextVersion, prereleaseTag }
}

/** @param {string} newVersion */
async function waitForPublish(newVersion) {
  let waitAttempts = 20

  loop: while (waitAttempts > 0) {
    try {
      // fetch the new package directly from the npm registry

      const url = `https://registry.npmjs.org/lazyrepo/-/lazyrepo-${newVersion}.tgz`
      console.log('looking for package at url: ', url)
      const res = await fetch(url, {
        method: 'HEAD',
      })
      if (res.status >= 400) {
        throw new Error(`Package not found: ${res.status}`)
      }
      break loop
    } catch (e) {
      console.log('Waiting for package to be published... attemptsRemaining', waitAttempts)
      waitAttempts--
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  if (waitAttempts === 0) {
    throw new Error('Timed out waiting for package to be published')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // module was called directly
  const currentBranch = exec('git rev-parse --abbrev-ref HEAD')
  if (currentBranch !== 'main') {
    throw new Error('Must be on main branch to publish')
  }

  await auto.loadConfig()
  const bump = await auto.getVersion()
  if (!bump) {
    // eslint-disable-next-line no-console
    console.log('nothing to do')
    process.exit(0)
  }

  const { nextVersion, prereleaseTag } = getNextVersion(bump)

  const npmToken = process.env.NPM_TOKEN
  if (!npmToken) {
    throw new Error('NPM_TOKEN not set')
  }

  exec(`npm version ${nextVersion} --no-git-tag-version`)
  // stage the changes
  exec('git add package.json')
  exec(`npm config set //registry.npmjs.org/:_authToken ${npmToken}`)
  exec(`npm config set registry https://registry.npmjs.org/`)
  exec(`npm whoami`)

  auto.hooks.beforeCommitChangelog.tap('beforeCommitChangelog', () => {
    exec('pnpm prettier --write CHANGELOG.md')
    exec('git add CHANGELOG.md')
  })
  // this creates a new commit
  await auto.changelog({
    useVersion: nextVersion,
    title: `v${nextVersion}`,
  })

  // eslint-disable-next-line no-console
  console.log('nextVersion: ' + nextVersion)

  // create and push a new tag
  exec(`git tag -f v${nextVersion}`)
  exec('git push --follow-tags')

  // create a release on github
  await auto.runRelease({ useVersion: nextVersion })

  // finally, publish the packages [IF THIS STEP FAILS, RUN THE `publish-manual.ts` script locally]
  exec(`npm publish --tag ${prereleaseTag || 'latest'} --access public`)
  if (nextVersion.startsWith('0.0.0')) {
    await waitForPublish(nextVersion)
    exec(`npm dist-tag add lazyrepo@${nextVersion} latest`)
  }
}
