/* eslint-disable no-console */

import { Octokit } from '@octokit/rest'
import { pathToFileURL } from 'url'

const VALID_LABELS = [
  'tests',
  'internal',
  'documentation',
  'dependencies',
  'major',
  'minor',
  'patch',
]

function getPRNumber() {
  const githubRef = process.env.GITHUB_REF
  if (!githubRef) {
    throw new Error('GITHUB_REF not set, exiting')
  }

  const [, type, num] = githubRef.split('/')
  if (type !== 'pull') {
    throw new Error('Not a pull request, exiting')
  }

  const prNumber = Number(num)
  if (!Number.isFinite(prNumber)) {
    throw new Error(`Invalid PR number: ${num}`)
  }

  console.log(`PR number: ${prNumber}`)
  return prNumber
}

/**
 * @param {number} prNumber
 */
async function checkPrLabels(prNumber) {
  if (!process.env.GH_TOKEN) {
    throw new Error('GH_TOKEN not set, exiting')
  }

  const octokit = new Octokit({
    auth: process.env.GH_TOKEN,
  })

  const pull = await octokit.rest.pulls.get({
    owner: 'ds300',
    pull_number: prNumber,
    repo: 'lazyrepo',
  })

  const releaseLabels = pull.data.labels
    .map((label) => label.name)
    .filter((label) => VALID_LABELS.includes(label))

  if (releaseLabels.length > 1) {
    throw new Error(`PR has multiple release labels: ${releaseLabels.join(', ')}`)
  }

  if (releaseLabels.length === 1) {
    console.log(`PR has release label: ${releaseLabels[0]}`)
    return
  }

  const prBody = pull.data.body

  const checkedLabels = VALID_LABELS.filter((label) =>
    prBody?.match(new RegExp(`^\\s*?-\\s*\\[\\s*x\\s*\\]\\s+\`${label}\``)),
  )

  if (checkedLabels.length > 1) {
    throw new Error(`PR has multiple checked labels: ${checkedLabels.join(', ')}`)
  }

  if (checkedLabels.length === 0) {
    throw new Error(
      `PR has no release labels or checked labels. Please add one of the following: ${VALID_LABELS.join(
        ', ',
      )}`,
    )
  }

  console.log(`PR has checked label item: ${checkedLabels[0]}`)
  console.log('Adding label to PR')

  await octokit.rest.issues.addLabels({
    issue_number: prNumber,
    owner: 'ds300',
    repo: 'lazyrepo',
    labels: checkedLabels,
  })

  console.log('Done!')

  return
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // module was called directly
  await checkPrLabels(process.argv[2] ? Number(process.argv[2]) : getPRNumber())
}
