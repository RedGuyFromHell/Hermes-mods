import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ciOf, fixPrompt, isGreen, jobIdOf, parsePr, siblingsOf, statusLines } from './register'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 140, scroll: { offset: 0, bodyRows: 13 }, view: {} },
} as const

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
  prompts: string[]
}

/** Stands for the machine: git and gh answer from the host record, every argv is kept. */
const fakeHost = (on: On, host: Host) => {
  /* Stands for the engine's own band, beneath every mod: the card draws above what it drew. */
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))
  on('session.cwd', () => ({ value: 'D:/Projects/HERMES' }))
  on('prompt.submit', (_$, e) => {
    host.prompts.push(e.text)
    return { text: e.text }
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

const host344 = (): Host => ({ branch: 'ship-via-gh', pr: PR_344, behind: '0', conflicts: { code: 0, out: 'Against main (1e61cef3):\n  ok        ship-via-gh\n\nAll clean.\n' }, ran: [], prompts: [] })

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
  const lines = statusLines(view)
  expect(lines.length).toBe(5)
  expect(lines.map(l => l.ok)).toEqual([false, true, true, true, true])
  expect(lines[0]?.detail).toBe(BILLING)
  expect(isGreen(view)).toBe(false)
  expect(fixPrompt(view)).toContain('Fix PR #344 (https://github.com/RedGuyFromHell/Hermes/pull/344)')
  expect(fixPrompt(view)).toContain(`- CI failed: check: ${BILLING}`)

  const green = parsePr(GREEN)
  if (green === null) return
  green.behind = 0
  green.siblings = { state: 'clean', detail: '' }
  expect(isGreen(green)).toBe(true)
  green.behind = 3
  expect(statusLines(green).find(l => l.ok === false)?.text).toBe('3 behind main')
})

for (const surface of SURFACES) {
  test(`the card shows the PR, the five chips with the CI reason, the link and the buttons (${surface})`, async ($, on) => {
    const host = host344()
    fakeHost(on, host)
    const r = await $.command.run({ command: 'pr', args: '', ...typed })
    expect(r.text).toContain('#344 open, something is red')
    const ui = await $.ui.mount({ plugin: 'hermes-pr', surface, ...BAND })
    expect(await ui.find({ text: /#344/ })).toBeDefined()
    expect(await ui.find({ text: /the Clean Historian opens the PR/ })).toBeDefined()
    expect(await ui.find({ text: /open on GitHub/ })).toBeDefined()
    expect(await ui.find({ text: /CI failed: check/ })).toBeDefined()
    expect(await ui.find({ text: /payments have failed/ })).toBeDefined()
    expect(await ui.find({ text: /no conflicts with main/ })).toBeDefined()
    expect(await ui.find({ text: /up to date with main/ })).toBeDefined()
    expect(await ui.find({ text: /clear of the other open PRs/ })).toBeDefined()
    expect(await ui.find({ text: /review: none required/ })).toBeDefined()
    expect(await ui.find({ key: 'merge' })).toBeDefined()
    expect(await ui.find({ key: 'fix' })).toBeDefined()
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(await ui.find({ key: 'reload' })).toBeDefined()
    /* What the engine drew beneath comes last: the card sits above it. */
    const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text ?? ''))
    expect(texts.indexOf('beneath')).toBe(texts.length - 1)
    await ui.unmount()
  })
}

test('merge asks first, a no changes nothing, a yes runs gh pr merge with a merge commit and the card shows merged', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  await $.command.run({ command: 'pr', args: '', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  await ui.press({ key: 'merge' })
  expect(await ui.find({ text: /merge #344 into main\?/ })).toBeDefined()
  expect(await ui.find({ text: /1 red line/ })).toBeDefined()
  await ui.press({ key: 'merge-no' })
  expect(host.ran.some(a => a.startsWith('gh pr merge'))).toBe(false)
  expect(await ui.find({ key: 'merge' })).toBeDefined()
  await ui.press({ key: 'merge' })
  await ui.press({ key: 'merge-yes' })
  expect(host.ran).toContain('gh pr merge 344 --merge')
  expect(await ui.find({ text: /merged #344/ })).toBeDefined()
  expect(await ui.find({ text: /release with/ })).toBeDefined()
  expect(await ui.find({ key: 'merge' })).toBeUndefined()
  await ui.unmount()
})

test('close asks first and then runs gh pr close; fix PR sends the red lines to the session', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  await $.command.run({ command: 'pr', args: '', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  await ui.press({ key: 'fix' })
  expect(host.prompts.length).toBe(1)
  expect(host.prompts[0]).toContain('Fix PR #344')
  expect(host.prompts[0]).toContain('CI failed: check')
  expect(await ui.find({ text: /sent to the session/ })).toBeDefined()
  await ui.press({ key: 'close' })
  expect(await ui.find({ text: /close #344\?/ })).toBeDefined()
  await ui.press({ key: 'close-yes' })
  expect(host.ran).toContain('gh pr close 344')
  expect(await ui.find({ text: /closed #344/ })).toBeDefined()
  await ui.unmount()
})

test('a green PR has a primary merge button and no fix button; without a PR, or on main, the card draws nothing', async ($, on) => {
  const host = host344()
  host.pr = GREEN
  fakeHost(on, host)
  const r = await $.command.run({ command: 'pr', args: '', ...typed })
  expect(r.text).toContain('all green')
  const ui = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /CI green/ })).toBeDefined()
  expect(await ui.find({ key: 'merge' })).toBeDefined()
  expect(await ui.find({ key: 'fix' })).toBeUndefined()
  await ui.unmount()

  host.pr = null
  const none = await $.command.run({ command: 'pr', args: '', ...typed })
  expect(none.text).toContain('no pull request on ship-via-gh')
  /* No PR: the card passes on, and only what the engine drew beneath is there. */
  const empty = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  expect(await empty.find({ text: /^beneath$/ })).toBeDefined()
  expect(await empty.find({ text: /#344|GitHub/ })).toBeUndefined()
  await empty.unmount()

  host.branch = 'main'
  await $.command.run({ command: 'pr', args: '', ...typed })
  const onMain = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  expect(await onMain.find({ text: /#344|GitHub/ })).toBeUndefined()
  await onMain.unmount()
  expect(host.ran.filter(a => a.startsWith('gh pr view')).length).toBe(2)
})

test('/pr hide takes the card down and /pr show brings it back', async ($, on) => {
  const host = host344()
  fakeHost(on, host)
  await $.command.run({ command: 'pr', args: '', ...typed })
  await $.command.run({ command: 'pr', args: 'hide', ...typed })
  const hidden = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  expect(await hidden.find({ text: /^beneath$/ })).toBeDefined()
  expect(await hidden.find({ text: /#344/ })).toBeUndefined()
  await hidden.unmount()
  await $.command.run({ command: 'pr', args: 'show', ...typed })
  const shown = await $.ui.mount({ plugin: 'hermes-pr', surface: 'terminal', ...BAND })
  expect(await shown.find({ text: /#344/ })).toBeDefined()
  await shown.unmount()
})

test('a git push in the chat makes the card read the PR again', async ($, on) => {
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
