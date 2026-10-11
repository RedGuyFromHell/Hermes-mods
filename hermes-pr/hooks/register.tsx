import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, CiState, Line, Mergeable, PrState, PrView, Review, Siblings } from '../types'

/*
 * hermes-pr reads the branch's pull request and runs the actions on it. It draws nothing:
 * hermes-band reads `hermes-pr.pr` and draws the PR row and the merge / fix PR / close PR
 * buttons, which run `/pr merge`, `/pr fix` and `/pr close` here.
 */

const NAME = 'hermes-pr'
const COMMAND = 'pr'
const FIELDS = 'number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'
/** A shell command that changes the PR or the branch on origin: the PR is read again after it. */
const CHANGES_PR = /\bgh\s+pr\s+(create|merge|close|ready|reopen)\b|\bgit\s+push\b/
/** A branch that never carries a PR of its own. */
const NO_PR_BRANCHES = ['', 'HEAD', 'main', 'prod']

/* ---------- state hermes-band draws from ---------- */

const PR = atom({ plugin: 'hermes-pr', key: 'pr' } as const, null)
const FIX = atom({ plugin: 'hermes-pr', key: 'fix' } as const, null)
const BRANCH = atom({ plugin: 'hermes-pr', key: 'branch' } as const, null)
const BUSY = atom({ plugin: 'hermes-pr', key: 'busy' } as const, null)
const NOTE = atom({ plugin: 'hermes-pr', key: 'note' } as const, null)
const REFRESHED = atom({ plugin: 'hermes-pr', key: 'refreshedAt' } as const, 0)
const HIDDEN = atom({ plugin: 'hermes-pr', key: 'hidden' } as const, false)

/* ---------- pure helpers (exported for the tests) ---------- */

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** One row of `statusCheckRollup`: a CheckRun carries status and conclusion, a StatusContext state. */
type Check = { name?: string; context?: string; status?: string; conclusion?: string | null; state?: string; detailsUrl?: string; targetUrl?: string }

export const ciOf = (rollup: readonly Check[]): { state: CiState; failing: string[]; detailsUrl: string | null } => {
  if (rollup.length === 0) return { state: 'none', failing: [], detailsUrl: null }
  const failing: string[] = []
  let pending = false
  let detailsUrl: string | null = null
  for (const check of rollup) {
    const name = check.name ?? check.context ?? 'check'
    const status = (check.status ?? '').toUpperCase()
    const verdict = (check.conclusion ?? check.state ?? '').toUpperCase()
    if (status !== '' && status !== 'COMPLETED') {
      pending = true
      continue
    }
    if (verdict === 'PENDING' || verdict === 'EXPECTED' || verdict === '') {
      pending = true
      continue
    }
    if (verdict === 'SUCCESS' || verdict === 'SKIPPED' || verdict === 'NEUTRAL') continue
    failing.push(name)
    detailsUrl ??= check.detailsUrl ?? check.targetUrl ?? null
  }
  return { state: failing.length > 0 ? 'fail' : pending ? 'pending' : 'pass', failing, detailsUrl }
}

/** `.../actions/runs/<run>/job/<id>` -> the job id, whose annotations say why a job never started. */
export const jobIdOf = (url: string | null) => (url === null ? null : (/\/job\/(\d+)/.exec(url)?.[1] ?? null))

/** The `gh pr view --json` answer to the record the band draws; null when it is not a PR. */
export const parsePr = (json: string): PrView | null => {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof raw.number !== 'number' || typeof raw.url !== 'string') return null
  const ci = ciOf(Array.isArray(raw.statusCheckRollup) ? (raw.statusCheckRollup as Check[]) : [])
  const state: PrState = raw.state === 'MERGED' ? 'merged' : raw.state === 'CLOSED' ? 'closed' : raw.isDraft === true ? 'draft' : 'open'
  const mergeable: Mergeable = raw.mergeable === 'MERGEABLE' ? 'clean' : raw.mergeable === 'CONFLICTING' ? 'conflicts' : 'unknown'
  const review: Review =
    raw.reviewDecision === 'APPROVED' ? 'approved' : raw.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : raw.reviewDecision === 'REVIEW_REQUIRED' ? 'required' : 'none'
  const view: PrView = {
    number: raw.number,
    url: raw.url,
    title: String(raw.title ?? ''),
    state,
    base: String(raw.baseRefName ?? 'main'),
    head: String(raw.headRefName ?? ''),
    ci: { state: ci.state, failing: ci.failing, reason: null, detailsUrl: ci.detailsUrl },
    mergeable,
    review,
    behind: null,
    siblings: null,
    lines: [],
  }
  view.lines = statusLines(view)
  return view
}

/** What `release/pr-conflicts.mjs` said, from its exit code and its lines; null when the repo has no such script. */
export const siblingsOf = (exitCode: number, stdout: string, stderr: string): Siblings | null => {
  if (!/Against main/.test(stdout) && /Cannot find module|ENOENT|no such file/i.test(stderr)) return null
  const conflicts = stdout
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('CONFLICT'))
    .map(line => line.replace(/^CONFLICT\s+/, ''))
  const detail = oneLine(conflicts.slice(0, 2).join('; '), 200)
  if (exitCode === 0) return { state: 'clean', detail: '' }
  if (exitCode === 1) return { state: 'main', detail }
  if (exitCode === 2) return { state: 'conflicts', detail }
  return { state: 'unknown', detail: oneLine(stderr.trim() || stdout.trim() || `exit ${exitCode}`, 160) }
}

const line = (ok: boolean | null, text: string, detail: string | null = null): Line => ({ ok, text, detail })

/** The status chips, in the band's order: CI, main, behind, the other PRs, review. */
export const statusLines = (v: PrView): Line[] => {
  const lines: Line[] = []
  const ci = v.ci
  if (ci.state === 'pass') lines.push(line(true, 'CI green'))
  else if (ci.state === 'pending') lines.push(line(null, 'CI running'))
  else if (ci.state === 'none') lines.push(line(null, 'no checks yet'))
  else lines.push(line(false, `CI failed: ${ci.failing.join(', ')}`, ci.reason))

  if (v.mergeable === 'clean') lines.push(line(true, `no conflicts with ${v.base}`))
  else if (v.mergeable === 'conflicts') lines.push(line(false, `conflicts with ${v.base}`))
  else lines.push(line(null, `GitHub is still checking ${v.base} for conflicts`))

  if (v.behind !== null) {
    if (v.behind === 0) lines.push(line(true, `up to date with ${v.base}`))
    else lines.push(line(false, `${v.behind} behind ${v.base}`))
  }

  if (v.siblings !== null) {
    const s = v.siblings
    if (s.state === 'clean') lines.push(line(true, 'clear of the other open PRs'))
    else if (s.state === 'conflicts') lines.push(line(false, 'conflicts with another open PR', s.detail))
    else if (s.state === 'main') lines.push(line(false, `conflicts with ${v.base} (the conflict script)`, s.detail))
    else lines.push(line(null, 'the conflict check failed', s.detail))
  }

  if (v.review === 'approved') lines.push(line(true, 'review: approved'))
  else if (v.review === 'changes') lines.push(line(false, 'review: changes requested'))
  else if (v.review === 'required') lines.push(line(false, 'review: a review is required'))
  else lines.push(line(true, 'review: none required'))
  return lines
}

export const isGreen = (v: PrView) => v.lines.every(l => l.ok === true)

/** The prompt `/pr fix` queues to the session: the PR, the red lines, and the ask. */
export const fixPrompt = (v: PrView) => {
  const red = v.lines.filter(l => l.ok === false).map(l => `- ${l.text}${l.detail !== null && l.detail !== '' ? `: ${l.detail}` : ''}`)
  return [
    `Fix PR #${v.number} (${v.url}), branch ${v.head} into ${v.base}. What is red:`,
    ...(red.length > 0 ? red : ['- nothing is red now; check the PR page']),
    '',
    `Merge origin/${v.base} in if the branch is behind or conflicting, make the gate green (node checks/check.mjs), push, and reply in a few lines with what changed. Never weaken a test to get there.`,
  ].join('\n')
}

/* ---------- the host: gh and git in the session's tree ---------- */

type Ran = { code: number; out: string; err: string }

const run = async ($: EngineInterface, argv: readonly string[], cwd: string, timeoutMs = 60_000): Promise<Ran> => {
  try {
    const r = await $.process.run([...argv], { cwd, timeoutMs })
    return { code: r.exitCode, out: r.stdout, err: r.stderr }
  } catch (err) {
    return { code: -1, out: '', err: message(err) }
  }
}

/** Why a failing job failed, from its check-run annotations: the text GitHub shows under a job that never started. */
const reasonOf = async ($: EngineInterface, cwd: string, detailsUrl: string | null): Promise<string | null> => {
  const job = jobIdOf(detailsUrl)
  if (job === null) return null
  const repo = await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner'], cwd)
  let full = ''
  try {
    full = String((JSON.parse(repo.out) as { nameWithOwner?: string }).nameWithOwner ?? '')
  } catch {
    return null
  }
  if (full === '') return null
  const r = await run($, ['gh', 'api', `repos/${full}/check-runs/${job}/annotations`], cwd)
  if (r.code !== 0) return null
  try {
    const rows = JSON.parse(r.out) as { annotation_level?: string; message?: string }[]
    const bad = rows.find(a => a.annotation_level === 'failure') ?? rows[0]
    return bad?.message === undefined ? null : oneLine(bad.message, 240)
  } catch {
    return null
  }
}

const setNote = ($: EngineInterface, note: string | null) => update($, NOTE, () => note)

/** Reads the branch's PR again. `fetch` also brings origin up to date first (/pr and the band's reload; never the timer). */
const refresh = async ($: EngineInterface, fetch = false): Promise<PrView | null> => {
  const cwd = await $.session.cwd()
  const branch = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)).out.trim()
  await update($, BRANCH, () => (branch === '' ? null : branch))
  const done = async (view: PrView | null) => {
    await update($, PR, () => view)
    await update($, FIX, () => (view !== null && (view.state === 'open' || view.state === 'draft') && view.lines.some(l => l.ok === false) ? fixPrompt(view) : null))
    await update($, REFRESHED, () => Date.now())
    return view
  }
  if (NO_PR_BRANCHES.includes(branch)) return done(null)

  const pr = await run($, ['gh', 'pr', 'view', '--json', FIELDS], cwd)
  const view = pr.code === 0 ? parsePr(pr.out) : null
  if (view === null) return done(null)

  if (view.ci.state === 'fail') view.ci.reason = await reasonOf($, cwd, view.ci.detailsUrl)
  if (fetch) await run($, ['git', 'fetch', '--quiet', 'origin', view.base], cwd, 120_000)
  const behind = await run($, ['git', 'rev-list', '--count', `HEAD..origin/${view.base}`], cwd)
  const count = Number.parseInt(behind.out.trim(), 10)
  view.behind = behind.code === 0 && Number.isFinite(count) ? count : null
  if (view.state === 'open' || view.state === 'draft') {
    const s = await run($, ['node', 'release/pr-conflicts.mjs', '--no-fetch'], cwd, 120_000)
    view.siblings = siblingsOf(s.code, s.out, s.err)
  }
  view.lines = statusLines(view)
  return done(view)
}

/** The timer's refresh: skipped while an action runs. */
const tick = async ($: EngineInterface) => {
  if ((await read($, BUSY)) !== null) return
  await refresh($)
}

/** merge or close, after the band's yes. One at a time; the result goes to the note and a toast. */
const act = async ($: EngineInterface, kind: Action): Promise<string> => {
  const view = await read($, PR)
  if (view === null) return `${NAME}: no pull request to ${kind}.`
  if ((await read($, BUSY)) !== null) return `${NAME}: busy, try again in a moment.`
  await update($, BUSY, () => kind)
  const cwd = await $.session.cwd()
  const argv = kind === 'merge' ? ['gh', 'pr', 'merge', String(view.number), '--merge'] : ['gh', 'pr', 'close', String(view.number)]
  const r = await run($, argv, cwd, 120_000)
  const note = r.code === 0 ? `${kind === 'merge' ? 'merged' : 'closed'} #${view.number}` : `${kind} refused: ${oneLine(r.err.trim() || r.out.trim() || 'no reason given', 200)}`
  await setNote($, note)
  try {
    $.ui.toast(`${NAME}: ${note}`)
  } catch {}
  await update($, BUSY, () => null)
  await refresh($, true)
  return `${NAME}: ${note}${r.code === 0 && kind === 'merge' ? '. Merging deploys nothing: release with node release/release.mjs.' : ''}`
}

/**
 * /pr fix, typed: the fix prompt goes into the prompt box for the person to send. A slash command may not
 * submit a prompt itself (it holds the turn); the band's fix PR button submits `hermes-pr.fix` from its press.
 */
const fix = async ($: EngineInterface): Promise<string> => {
  const text = await read($, FIX)
  if (text === null) return `${NAME}: nothing is red on this PR.`
  try {
    const filled = await $.prompt.fill({ text, mode: 'replace' })
    return filled.isFilled ? `${NAME}: the fix prompt is in the box; send it when ready.` : `${NAME}: could not fill the prompt box here.`
  } catch (err) {
    return `${NAME}: fix PR failed: ${message(err)}`
  }
}

/** After a shell command that touched the PR or pushed the branch: read the PR again. */
const afterShell = async ($: EngineInterface, command: unknown) => {
  if (typeof command === 'string' && CHANGES_PR.test(command)) await refresh($, true)
}

/* ---------- registration ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: `${NAME}: read this branch's PR again for the band's PR row; merge | close act on it (the band's buttons run these), fix puts the fix prompt in the box; hide | show`,
      argumentHint: 'merge | fix | close | hide | show',
    })
    try {
      $.clock.after(100, () => void refresh($))
      $.clock.every(60_000, () => void tick($))
    } catch {}
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hide') {
      await update($, HIDDEN, () => true)
      return { text: `${NAME}: the PR row is hidden until /pr show.` }
    }
    if (arg === 'show') {
      await update($, HIDDEN, () => false)
      return { text: `${NAME}: the PR row is back.` }
    }
    if (arg === 'merge' || arg === 'close') return { text: await act($, arg) }
    if (arg === 'fix') return { text: await fix($) }
    await update($, HIDDEN, () => false)
    await setNote($, null)
    const view = await refresh($, true)
    const branch = await read($, BRANCH)
    return { text: view === null ? `${NAME}: no pull request on ${branch ?? 'this branch'}.` : `${NAME}: #${view.number} ${view.state}, ${isGreen(view) ? 'all green' : 'something is red'}.` }
  })

  /* A push or a gh pr command in the chat: the PR is read again once it ran. The read is awaited (a few seconds, after a rare command) so a host without a clock sees it too. */
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    await afterShell($, e.command)
    return ran
  })
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    await afterShell($, e.command)
    return ran
  })
}
