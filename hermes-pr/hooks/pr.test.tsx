import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { PrView } from '../types'
import { ciOf, fixPrompt, isGreen, jobIdOf, parsePr, siblingsOf, statusLines } from './register'

const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 140 } }


/** PR #344 as `gh pr view --json` printed it on 2026-10-11, its one check refused by Actions billing. */
const PR_344 = JSON.stringify({
  baseRefName: 'main',
  headRefName: 'ship-via-gh',
  isDraft: false,
  mergeStateStatus: 'UNSTABLE',
  mergeable: 'MERGEABLE',
  number: 344,
  reviewDecision: '',
  state: 'OPEN',
  statusCheckRollup: [
    {
      __typename: 'CheckRun',
      completedAt: '2026-10-11T13:13:41Z',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/RedGuyFromHell/Hermes/actions/runs/38142329074/job/114478561391',
      name: 'check',
      startedAt: '2026-10-11T13:13:40Z',
      status: 'COMPLETED',
      workflowName: 'check',
    },
  ],
  title: 'feat(ship): the Clean Historian opens the PR with gh, with a body that says only what the diff cannot',
  url: 'https://github.com/RedGuyFromHell/Hermes/pull/344',
})

const BILLING = 'The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the Billing & plans section in your settings'

const GREEN = JSON.stringify({
  ...JSON.parse(PR_344),
  statusCheckRollup: [{ __typename: 'CheckRun', conclusion: 'SUCCESS', name: 'check', status: 'COMPLETED', detailsUrl: 'https://github.com/x/y/actions/runs/1/job/2' }],
})

const answer = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

type Host = {
  branch: string
  /** What `gh pr view` prints; null is "no pull requests found". */
  pr: string | null
  behind: string
  conflicts: { code: number; out: string }
  ran: string[]
  /** What /pr fix put in the prompt box. */
  filled: string[]
  /** Every value hermes-pr wrote, by key: what the band would read. The test `$` has no `$.state` of its own. */
  state: Record<string, unknown>
}

/** Stands for the machine: git and gh answer from the host record, every argv is kept, every state write is seen. */
const fakeHost = (on: On, host: Host) => {
  on('session.cwd', () => ({ value: 'D:/Projects/HERMES' }))
  on('state.set', { plugin: 'hermes-pr' }, (_$, e, next) => {
    host.state[e.key] = e.value
    return next(e)
  })
  on('prompt.fill', (_$, e) => {
    host.filled.push(e.text)
    return { isFilled: true }
  })
  on('process.run', (_$, e) => {
    const a = e.argv.join(' ')
    host.ran.push(a)
    if (a.startsWith('git rev-parse --abbrev-ref')) return answer(0, `${host.branch}\n`)
    if (a.startsWith('gh pr view')) return host.pr === null ? answer(1, '', 'no pull requests found for branch "ship-via-gh"') : answer(0, host.pr)
    if (a.startsWith('gh repo view')) return answer(0, '{"nameWithOwner":"RedGuyFromHell/Hermes"}')
    if (a.startsWith('gh api repos/RedGuyFromHell/Hermes/check-runs/114478561391/annotations')) return answer(0, JSON.stringify([{ annotation_level: 'failure', message: BILLING }]))
    if (a.startsWith('git fetch')) return answer(0, '')
    if (a.startsWith('git rev-list --count')) return answer(0, `${host.behind}\n`)
    if (a.startsWith('node release/pr-conflicts.mjs')) return answer(host.conflicts.code, host.conflicts.out)
    if (a.startsWith('gh pr merge') || a.startsWith('gh pr close')) {
      host.pr = JSON.stringify({ ...JSON.parse(host.pr ?? '{}'), state: a.startsWith('gh pr merge') ? 'MERGED' : 'CLOSED' })
      return answer(0, '')
    }
    return answer(0, '')
  })
}

const host344 = (): Host => ({ branch: 'ship-via-gh', pr: PR_344, behind: '0', conflicts: { code: 0, out: 'Against main (1e61cef3):\n  ok        ship-via-gh\n\nAll clean.\n' }, ran: [], filled: [], state: {} })

const prOf = (host: Host) => host.state.pr as PrView | null | undefined

test('the helpers: the PR record, the CI verdict, the job id, the conflict script and the lines', async () => {
  const view = parsePr(PR_344)
  expect(view).toBeDefined()
  if (view === null) return
  expect(view.number).toBe(344)
  expect(view.state).toBe('open')
  expect(view.mergeable).toBe('clean')
  expect(view.review).toBe('none')
  expect(view.ci.state).toBe('fail')
  expect(view.ci.failing).toEqual(['check'])
  expect(jobIdOf(view.ci.detailsUrl)).toBe('114478561391')
  expect(parsePr('not json')).toBe(null)
  expect(parsePr('{"title":"no number"}')).toBe(null)

  expect(ciOf([]).state).toBe('none')
  expect(ciOf([{ name: 'a', status: 'IN_PROGRESS' }]).state).toBe('pending')
  expect(ciOf([{ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' }, { context: 'b', state: 'SUCCESS' }]).state).toBe('pass')
  expect(ciOf([{ name: 'a', status: 'COMPLETED', conclusion: 'SKIPPED' }, { name: 'b', status: 'COMPLETED', conclusion: 'CANCELLED' }]).failing).toEqual(['b'])

  expect(siblingsOf(0, 'All clean.', '')).toEqual({ state: 'clean', detail: '' })
  expect(siblingsOf(2, 'Against main (abc):\n  ok  a\n\nWith each other:\n  CONFLICT  a + b: docs/x.md\n', '')).toEqual({ state: 'conflicts', detail: 'a + b: docs/x.md' })
  expect(siblingsOf(1, 'Against main (abc):\n  CONFLICT  a: README.md\n', '')?.state).toBe('main')
  expect(siblingsOf(1, '', "Error: Cannot find module 'D:\\x\\release\\pr-conflicts.mjs'")).toBe(null)

  view.behind = 0
  view.siblings = { state: 'clean', detail: '' }
  view.ci.reason = BILLING
  view.lines = statusLines(view)
  expect(view.lines.length).toBe(5)
  expect(view.lines.map(l => l.ok)).toEqual([false, true, true, true, true])
  expect(view.lines[0]?.detail).toBe(BILLING)
  expect(isGreen(view)).toBe(false)
  expect(fixPrompt(view)).toContain('Fix PR #344 (https://github.com/RedGuyFromHell/Hermes/pull/344)')
  expect(fixPrompt(view)).toContain(`- CI failed: check: ${BILLING}`)

  const green = parsePr(GREEN)
  if (green === null) return
  green.behind = 0
  green.siblings = { state: 'clean', detail: '' }
  green.lines = statusLines(green)
  expect(isGreen(green)).toBe(true)
  green.behind = 3
  expect(statusLines(green).find(l => l.ok === false)?.text).toBe('3 behind main')
})

test('/pr reads the PR into the state the band draws: five lines, the CI reason, behind and the sibling check', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  const r = await $.command.run({ command: 'pr', args: '', ...typed })
  expect(r.text).toContain('#344 open, something is red')
  const view = prOf(host)
  expect(view).toBeDefined()
  if (view === null || view === undefined) return
  expect(view.number).toBe(344)
  expect(view.lines.map(l => l.text)).toEqual(['CI failed: check', 'no conflicts with main', 'up to date with main', 'clear of the other open PRs', 'review: none required'])
  expect(view.lines[0]?.detail).toBe(BILLING)
  expect(String(host.state.fix)).toContain(`- CI failed: check: ${BILLING}`)
  expect(host.ran).toContain('git fetch --quiet origin main')
  expect(host.ran).toContain('node release/pr-conflicts.mjs --no-fetch')

  host.pr = GREEN
  const green = await $.command.run({ command: 'pr', args: '', ...typed })
  expect(green.text).toContain('all green')
  expect(host.state.fix).toBe(null)

  host.pr = null
  const none = await $.command.run({ command: 'pr', args: '', ...typed })
  expect(none.text).toContain('no pull request on ship-via-gh')
  expect(prOf(host)).toBe(null)

  host.branch = 'main'
  const views = host.ran.filter(a => a.startsWith('gh pr view')).length
  await $.command.run({ command: 'pr', args: '', ...typed })
  expect(host.ran.filter(a => a.startsWith('gh pr view')).length).toBe(views)
})

test('/pr merge runs gh pr merge with a merge commit, /pr close runs gh pr close, and each reads the PR again', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  await $.command.run({ command: 'pr', args: '', ...typed })
  const merged = await $.command.run({ command: 'pr', args: 'merge', ...typed })
  expect(host.ran).toContain('gh pr merge 344 --merge')
  expect(merged.text).toContain('merged #344')
  expect(merged.text).toContain('release.mjs')
  expect(prOf(host)?.state).toBe('merged')
  expect(host.state.note).toBe('merged #344')
  expect(host.state.fix).toBe(null)

  host.pr = PR_344
  await $.command.run({ command: 'pr', args: '', ...typed })
  const closed = await $.command.run({ command: 'pr', args: 'close', ...typed })
  expect(host.ran).toContain('gh pr close 344')
  expect(closed.text).toContain('closed #344')
  expect(prOf(host)?.state).toBe('closed')
})

test('/pr fix puts the red lines in the prompt box as one prompt', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  await $.command.run({ command: 'pr', args: '', ...typed })
  const r = await $.command.run({ command: 'pr', args: 'fix', ...typed })
  expect(r.text).toContain('in the box')
  expect(host.filled.length).toBe(1)
  expect(host.filled[0]).toContain('Fix PR #344')
  expect(host.filled[0]).toContain(`- CI failed: check: ${BILLING}`)
  host.pr = GREEN
  await $.command.run({ command: 'pr', args: '', ...typed })
  const nothing = await $.command.run({ command: 'pr', args: 'fix', ...typed })
  expect(nothing.text).toContain('nothing is red')
  expect(host.filled.length).toBe(1)
})

test('/pr hide and /pr show flip the hidden flag the band reads', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  await $.command.run({ command: 'pr', args: 'hide', ...typed })
  expect(host.state.hidden).toBe(true)
  await $.command.run({ command: 'pr', args: 'show', ...typed })
  expect(host.state.hidden).toBe(false)
})

test('a git push in the chat makes hermes-pr read the PR again', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never }))
  await $.command.run({ command: 'pr', args: '', ...typed })
  const before = host.ran.filter(a => a.startsWith('gh pr view')).length
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin ship-via-gh' })
  expect(host.ran.filter(a => a.startsWith('gh pr view')).length).toBe(before + 1)
  await $.tool.call({ tool: 'Bash', command: 'git status --short' })
  expect(host.ran.filter(a => a.startsWith('gh pr view')).length).toBe(before + 1)
})
