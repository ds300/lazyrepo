import { Request } from '@cloudflare/workers-types'
import { Octokit } from '@octokit/rest'
import { PullRequestEvent } from '@octokit/webhooks-types'

export interface Env {
  GH_TOKEN: string
}

const VALID_LABELS = [
  'tests',
  'internal',
  'documentation',
  'dependencies',
  'major',
  'minor',
  'patch',
]

async function checkPrLabels(prEvent: PullRequestEvent, env: Env) {
  if (!env.GH_TOKEN) {
    throw new Error('GH_TOKEN not set, exiting')
  }

  const octokit = new Octokit({
    auth: env.GH_TOKEN,
  })

  const fail = async (message: string) => {
    await octokit.rest.repos.createCommitStatus({
      owner: prEvent.repository.owner.login,
      repo: prEvent.repository.name,
      sha: prEvent.pull_request.head.sha,
      state: 'failure',
      description: message,
      context: 'release-label-check',
    })
  }

  const succeed = async (message: string) => {
    await octokit.rest.repos.createCommitStatus({
      owner: prEvent.repository.owner.login,
      repo: prEvent.repository.name,
      sha: prEvent.pull_request.head.sha,
      state: 'success',
      description: message,
      context: 'release-label-check',
    })
  }

  const pull = prEvent.pull_request

  if (pull.draft) {
    return await succeed('Draft PR, skipping label check')
  }

  if (pull.closed_at || pull.merged_at) {
    return await succeed('Closed PR, skipping label check')
  }

  const currentReleaseLabels = pull.labels
    .map((label) => label.name)
    .filter((label) => VALID_LABELS.includes(label))

  if (currentReleaseLabels.length > 1) {
    return fail(`PR has multiple release labels: ${currentReleaseLabels.join(', ')}`)
  }

  const prBody = pull.body

  const selectedReleaseLabels = VALID_LABELS.filter((label) =>
    prBody?.match(new RegExp(`^\\s*?-\\s*\\[\\s*x\\s*\\]\\s+\`${label}\``, 'm')),
  )

  if (selectedReleaseLabels.length > 1) {
    return await fail(
      `PR has multiple checked labels: ${selectedReleaseLabels.join(', ')}. Please select only one`,
    )
  }

  const [current] = currentReleaseLabels
  const [selected] = selectedReleaseLabels

  if (!current && !selected) {
    return await fail(
      `Please assign one of the following release labels to this PR: ${VALID_LABELS.join(', ')}`,
    )
  }

  if (current === selected || (current && !selected)) {
    return succeed(`PR has label: ${current}`)
  }

  // otherwise the label has changed or is being set for the first time
  // from the pr body
  if (current) {
    await octokit.rest.issues.removeLabel({
      issue_number: prEvent.number,
      name: current,
      owner: 'ds300',
      repo: 'lazyrepo',
    })
  }

  console.log('adding labels')
  await octokit.issues.addLabels({
    issue_number: pull.number,
    owner: prEvent.repository.organization ?? prEvent.repository.owner.login,
    repo: prEvent.repository.name,
    labels: [selected],
  })

  return await succeed(`PR label set to: ${selected}`)
}

export default {
  async fetch(request: Request, env: Env) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const data = (await request.json()) as PullRequestEvent
    await checkPrLabels(data, env)
    return new Response('Hello world')
  },
}
