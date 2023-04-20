import autopkg from '@auto-it/core'
import { execSync } from 'child_process'
import { parse } from 'semver'
import { pathToFileURL } from 'url'
import { exec } from './lib/exec.js'

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
  const currentVersion = parse(exec('pnpm view . version'))
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // module was called directly
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
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

  // this creates a new commit
  await auto.changelog({
    useVersion: nextVersion,
    title: `v${nextVersion}`,
  })

  // eslint-disable-next-line no-console
  console.log('nextVersion: ' + nextVersion)

  // create and push a new tag
  execSync(`git tag -f v${nextVersion}`, { stdio: 'inherit' })
  execSync('git push --follow-tags', { stdio: 'inherit' })

  // create a release on github
  await auto.runRelease({ useVersion: nextVersion })

  // finally, publish the packages [IF THIS STEP FAILS, RUN THE `publish-manual.ts` script locally]
  exec(`npm publish --tag ${prereleaseTag || 'latest'} --access public`)
}
