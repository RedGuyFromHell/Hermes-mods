import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, CiState, Line, Mergeable, PrState, PrView, Review, Siblings } from '../types'

const NAME = 'hermes-pr'
const PANE = 'hermes-pr'
const TITLE = 'PR'
const COMMAND = 'pr'
const FIELDS = 'number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup'
/** A shell command that changes the PR or the branch on origin: the pane refreshes after it. */
const CHANGES_PR = /\bgh\s+pr\s+(create|merge|close|ready|reopen)\b|\bgit\s+push\b/
/** A branch that never carries a PR of its own. */
const NO_PR_BRANCHES = ['', 'HEAD', 'main', 'prod']

/* ---------- state the pane draws from ---------- */

const PR = atom({ plugin: 'hermes-pr', key: 'pr' } as const, null)
const BRANCH = atom({ plugin: 'hermes-pr', key: 'branch' } as const, null)
const CONFIRM = atom({ plugin: 'hermes-pr', key: 'confirm' } as const, null)
const BUSY = atom({ plugin: 'hermes-pr', key: 'busy' } as const, null)
const NOTE = atom({ plugin: 'hermes-pr', key: 'note' } as const, null)
const REFRESHED = atom({ plugin: 'hermes-pr', key: 'refreshedAt' } as const, 0)
const AUTO_OPENED = atom({ plugin: 'hermes-pr', key: 'autoOpened' } as const, false)

/* ---------- colors: hermes-band's palette ---------- */

const C = {
  branch: '#c084fc',
  tree: '#22d3ee',
  ok: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  blue: '#60a5fa',
  card: '#1f2937',
}

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

/** The `gh pr view --json` answer to the record the pane draws; null when it is not a PR. */
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
  return {
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
  }
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

/** The status lines, in the pane's order: CI, main, behind, the other PRs, review. */
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
    else lines.push(line(false, `${v.behind} commit${v.behind === 1 ? '' : 's'} behind ${v.base}`))
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

export const isGreen = (v: PrView) => statusLines(v).every(l => l.ok === true)

/** The prompt `fix PR` queues to the session: the PR, the red lines, and the ask. */
export const fixPrompt = (v: PrView) => {
  const red = statusLines(v)
    .filter(l => l.ok === false)
    .map(l => `- ${l.text}${l.detail !== null && l.detail !== '' ? `: ${l.detail}` : ''}`)
  return [
    `Fix PR #${v.number} (${v.url}), branch ${v.head} into ${v.base}. What is red:`,
    ...(red.length > 0 ? red : ['- nothing is red now; check the PR page']),
    '',
    `Merge origin/${v.base} in if the branch is behind or conflicting, make the gate green (node checks/check.mjs), push, and reply in a few lines with what changed. Never weaken a test to get there.`,
  ].join('\n')
}

export const ago = (ms: number) => {
  if (ms < 1500) return 'just now'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
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

const openPane = async ($: EngineInterface) => {
  try {
    await $.ui.open({ id: PANE, title: TITLE })
  } catch (err) {
    await setNote($, `pane: ${message(err)}`)
  }
}

/**
 * Reads the branch's PR again. `fetch` also brings origin up to date first (the reload button; never the timer).
 * `open` lets the pane open by itself the first time an open PR is found; `/pr` opens it itself and passes false.
 */
const refresh = async ($: EngineInterface, fetch = false, open = true): Promise<PrView | null> => {
  const cwd = await $.session.cwd()
  const branch = (await run($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)).out.trim()
  await update($, BRANCH, () => (branch === '' ? null : branch))
  const done = async (view: PrView | null) => {
    await update($, PR, () => view)
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
  await done(view)

  if (open && (view.state === 'open' || view.state === 'draft') && !(await read($, AUTO_OPENED))) {
    await update($, AUTO_OPENED, () => true)
    await openPane($)
  }
  return view
}

/** The timer's refresh: skipped while an action runs. */
const tick = async ($: EngineInterface) => {
  if ((await read($, BUSY)) !== null) return
  await refresh($)
}

/** merge or close, after the yes. One at a time; the result goes to the note and a toast. */
const act = async ($: EngineInterface, kind: Action) => {
  const view = await read($, PR)
  if (view === null || (await read($, BUSY)) !== null) return
  await update($, CONFIRM, () => null)
  await update($, BUSY, () => kind)
  const cwd = await $.session.cwd()
  const argv = kind === 'merge' ? ['gh', 'pr', 'merge', String(view.number), '--merge'] : ['gh', 'pr', 'close', String(view.number)]
  const r = await run($, argv, cwd, 120_000)
  const note = r.code === 0 ? `${kind === 'merge' ? 'merged' : 'closed'} #${view.number}` : `${kind} refused: ${oneLine(r.err.trim() || r.out.trim() || 'no reason given', 200)}`
  await setNote($, note)
  $.ui.toast(`${NAME}: ${note}`)
  await update($, BUSY, () => null)
  await refresh($, true)
}

/** fix PR: one prompt to this session, a turn of its own once it is idle. */
const fix = async ($: EngineInterface) => {
  const view = await read($, PR)
  if (view === null) return
  try {
    await $.prompt.submit({ text: fixPrompt(view) })
    await setNote($, `fix PR #${view.number}: sent to the session`)
  } catch (err) {
    await setNote($, `fix PR failed: ${message(err)}`)
  }
}

const reload = async ($: EngineInterface) => {
  await setNote($, null)
  await refresh($, true)
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
      description: `${NAME}: open the PR pane for this branch (merge, fix, close, reload); "hide" keeps it from opening by itself`,
      argumentHint: 'hide',
    })
    try {
      $.clock.after(100, () => void refresh($))
      $.clock.every(60_000, () => void tick($))
    } catch {}
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() === 'hide') {
      await update($, AUTO_OPENED, () => true)
      return { text: `${NAME}: the pane stays closed until /pr.` }
    }
    const view = await refresh($, true, false)
    await update($, AUTO_OPENED, () => true)
    await openPane($)
    const branch = await read($, BRANCH)
    return { text: view === null ? `${NAME}: no pull request on ${branch ?? 'this branch'}.` : `${NAME}: #${view.number} ${view.state}, ${isGreen(view) ? 'all green' : 'something is red'}.` }
  })

  /* A push or a gh pr command in the chat: the pane reads the PR again once it ran. The read is awaited (a few seconds, after a rare command) so a host without a clock sees it too. */
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const view = await read($, PR)
    const branch = await read($, BRANCH)
    const confirm = await read($, CONFIRM)
    const busy = await read($, BUSY)
    const note = await read($, NOTE)
    const refreshedAt = await read($, REFRESHED)
    const dot = <Text dimColor> · </Text>
    const reloadButton = (
      <Button key="reload" hotkey="r" plain dimColor hover={{ color: C.tree, bold: true }} onPress={() => void reload($)}>
        ↻
      </Button>
    )
    const noteLine =
      note !== null ? (
        <Text dimColor wrap="truncate-end">
          {note}
        </Text>
      ) : null

    if (view === null) {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box key="empty-head" flexDirection="row" gap={1} alignItems="center">
            <Text>
              <Text color={C.warn} bold>
                ⎇ PR
              </Text>
              {dot}
              <Text dimColor>{branch === null ? 'reading the branch…' : NO_PR_BRANCHES.includes(branch) ? `on ${branch}: a PR needs its own branch` : `no pull request on ${branch}`}</Text>
            </Text>
            {reloadButton}
          </Box>
          {noteLine}
        </Box>
      )
    }

    const lines = statusLines(view)
    const red = lines.filter(l => l.ok === false)
    const green = red.length === 0 && lines.every(l => l.ok === true)
    const open = view.state === 'open' || view.state === 'draft'
    const stateColor = view.state === 'merged' ? C.branch : view.state === 'closed' ? C.bad : view.state === 'draft' ? C.warn : C.ok

    const header = (
      <Box key="header" flexDirection="row" justifyContent="space-between" gap={2}>
        <Text wrap="truncate-end">
          <Text color={C.warn} bold>
            ⎇ #{view.number}{' '}
          </Text>
          <Text bold>{view.title}</Text>
        </Text>
        <Link href={view.url} label="open on GitHub ↗" />
      </Box>
    )
    const subline = (
      <Box key="subline" flexDirection="row" gap={1} alignItems="center">
        <Text wrap="truncate-end">
          <Text color={C.branch}>{view.base}</Text>
          <Text dimColor> ← </Text>
          <Text color={C.tree}>{view.head}</Text>
          {dot}
          <Text color={stateColor} bold>
            {view.state}
          </Text>
          {dot}
          <Text dimColor>refreshed {refreshedAt === 0 ? 'never' : ago(Date.now() - refreshedAt)}</Text>
        </Text>
        {reloadButton}
      </Box>
    )

    const status = (
      <Box key="status" flexDirection="column" flexGrow={1} flexShrink={1}>
        {lines.map((l, i) => (
          <Box key={`line-${i}`} flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={l.ok === true ? C.ok : l.ok === false ? C.bad : C.warn} bold>
                {l.ok === true ? '✓' : l.ok === false ? '✗' : '…'}{' '}
              </Text>
              <Text dimColor={l.ok === null}>{l.text}</Text>
            </Text>
            {l.detail !== null && l.detail !== '' ? <Text dimColor>{`   ${l.detail}`}</Text> : null}
          </Box>
        ))}
      </Box>
    )

    let buttons = null
    if (open && busy !== null) {
      buttons = (
        <Text color={C.warn} bold>
          {busy === 'merge' ? 'merging…' : 'closing…'}
        </Text>
      )
    } else if (open && confirm !== null) {
      const kind = confirm
      buttons = (
        <Box key={`confirm-${kind}`} flexDirection="column" alignItems="flex-end">
          <Text color={C.bad} bold>
            {kind === 'merge' ? `merge #${view.number} into ${view.base}?` : `close #${view.number}?`}
          </Text>
          {kind === 'merge' && red.length > 0 ? (
            <Text color={C.warn}>
              {red.length} red line{red.length === 1 ? '' : 's'}
            </Text>
          ) : null}
          <Box flexDirection="row" gap={1}>
            <Button key={`${kind}-yes`} variant="primary" onPress={() => void act($, kind)}>
              yes
            </Button>
            <Button key={`${kind}-no`} onPress={() => void update($, CONFIRM, () => null)}>
              no
            </Button>
          </Box>
        </Box>
      )
    } else if (open) {
      buttons = (
        <Box key="buttons" flexDirection="column" alignItems="flex-end">
          <Button key="merge" hotkey="m" {...(green ? { variant: 'primary' as const } : {})} hover={{ color: C.ok, bold: true }} onPress={() => void update($, CONFIRM, () => 'merge')}>
            merge
          </Button>
          {red.length > 0 ? (
            <Button key="fix" hotkey="f" hover={{ color: C.warn, bold: true }} onPress={() => void fix($)}>
              fix PR
            </Button>
          ) : null}
          <Button key="close" hotkey="c" hover={{ color: C.bad, bold: true }} onPress={() => void update($, CONFIRM, () => 'close')}>
            close PR
          </Button>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {subline}
        <Box flexDirection="row" gap={2} marginTop={1}>
          {status}
          {buttons}
        </Box>
        {view.state === 'merged' ? (
          <Text wrap="truncate-end">
            <Text color={C.branch} bold>
              merged
            </Text>
            <Text dimColor> · merging deploys nothing: release with </Text>
            <Text color={C.tree}>node release/release.mjs</Text>
          </Text>
        ) : null}
        {noteLine}
      </Box>
    )
  })
}
