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

  const currentReleaseLabels = pull.data.labels
    .map((label) => label.name)
    .filter((label) => VALID_LABELS.includes(label))

  if (currentReleaseLabels.length > 1) {
    throw new Error(`PR has multiple release labels: ${currentReleaseLabels.join(', ')}`)
  }

  const prBody = pull.data.body

  const selectedReleaseLabels = VALID_LABELS.filter((label) =>
    prBody?.match(new RegExp(`^\\s*?-\\s*\\[\\s*x\\s*\\]\\s+\`${label}\``, 'm')),
  )

  if (selectedReleaseLabels.length > 1) {
    throw new Error(
      `PR has multiple checked labels: ${selectedReleaseLabels.join(', ')}. Please select only one`,
    )
  }

  const [current] = currentReleaseLabels
  const [selected] = selectedReleaseLabels

  if (!current && !selected) {
    throw new Error(
      `Please assign one of the following release labels to this PR: ${VALID_LABELS.join(', ')}`,
    )
  }

  if (current === selected || (current && !selected)) {
    console.log(`PR already has label: ${current}`)
    return
  }

  // otherwise the label has changed or is being set for the first time
  // from the pr body
  if (current) {
    console.log(`Removing label: ${current}`)
    await octokit.rest.issues.removeLabel({
      issue_number: prNumber,
      name: current,
      owner: 'ds300',
      repo: 'lazyrepo',
    })
  }

  console.log(`Adding label: ${selected}`)
  await octokit.rest.issues.addLabels({
    issue_number: prNumber,
    owner: 'ds300',
    repo: 'lazyrepo',
    labels: [selected],
  })

  console.log('Done!')

  return
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // module was called directly
  await checkPrLabels(process.argv[2] ? Number(process.argv[2]) : getPRNumber())
}
