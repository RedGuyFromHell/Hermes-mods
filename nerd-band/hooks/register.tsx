import type { EngineInterface, Register } from 'claude-code'

import type { Context, ContextSlice, Limit, Nested, Repo, Server } from '../types'

const NAME = 'nerd-band'

/** The band draws only in the Nerd Castle knowledge base and its worktrees; hermes-band steps aside there. */
const HOME = /\/nerd-castle(\/|$)/i

/** The repos inside the knowledge base that are committed on their own (CLAUDE.md, Two stations). */
const NESTED: readonly (readonly [string, string])[] = [
  ['theme', 'store/Nerd-Castle-Liquid'],
  ['workbench', 'tools/workbench'],
  ['etsy', 'tools/etsy-mcp-server'],
]

/* ---------- state the band draws from ---------- */

const REPO = { plugin: 'nerd-band', key: 'repo' } as const
const SERVERS = { plugin: 'nerd-band', key: 'servers' } as const
const MINE = { plugin: 'nerd-band', key: 'mine' } as const
const CONFIRM = { plugin: 'nerd-band', key: 'confirmStop' } as const
const HIDDEN = { plugin: 'nerd-band', key: 'hidden' } as const
const NOTE = { plugin: 'nerd-band', key: 'note' } as const
const SCANNED = { plugin: 'nerd-band', key: 'scannedAt' } as const
const FETCHED = { plugin: 'nerd-band', key: 'fetchedAt' } as const
const CONTEXT = { plugin: 'nerd-band', key: 'context' } as const

const getContext = async ($: EngineInterface): Promise<Context | null> => (await $.state.get(CONTEXT)).value ?? null
const getRepo = async ($: EngineInterface): Promise<Repo | null> => (await $.state.get(REPO)).value ?? null
const getServers = async ($: EngineInterface): Promise<Server[]> => (await $.state.get(SERVERS)).value ?? []
const getMine = async ($: EngineInterface): Promise<string[]> => (await $.state.get(MINE)).value ?? []
const getConfirm = async ($: EngineInterface): Promise<boolean> => (await $.state.get(CONFIRM)).value ?? false
const getHidden = async ($: EngineInterface): Promise<boolean> => (await $.state.get(HIDDEN)).value ?? false
const getNote = async ($: EngineInterface): Promise<string | null> => (await $.state.get(NOTE)).value ?? null
const getScanned = async ($: EngineInterface): Promise<number> => (await $.state.get(SCANNED)).value ?? 0
const getFetched = async ($: EngineInterface): Promise<number> => (await $.state.get(FETCHED)).value ?? 0

const setNote = ($: EngineInterface, note: string | null) => $.state.set(NOTE, note)
const setConfirm = ($: EngineInterface, on: boolean) => $.state.set(CONFIRM, on)
const setHidden = ($: EngineInterface, on: boolean) => $.state.set(HIDDEN, on)

/* ---------- colors ---------- */

const C = {
  branch: '#c084fc',
  tree: '#22d3ee',
  ok: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  theme: '#4ade80',
  video: '#60a5fa',
}

/* ---------- helpers ---------- */

const norm = (p: string) => p.replace(/\\/g, '/')
const basename = (p: string) => norm(p).replace(/\/+$/, '').split('/').pop() ?? p
const unquote = (s: string) => s.replace(/^"(.*)"$/, '$1')
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** False outside the knowledge base: every hook then passes straight on. */
let active: boolean | null = null
const atHome = async ($: EngineInterface): Promise<boolean> => {
  if (active !== null) return active
  try {
    active = HOME.test(norm(await $.session.cwd()))
    return active
  } catch {
    return false
  }
}

/** One git command's stdout, trimmed; `raw` keeps the leading spaces a porcelain status line starts with. */
const git = async ($: EngineInterface, args: readonly string[], cwd: string, raw = false): Promise<string | null> => {
  try {
    const r = await $.process.run(['git', ...args], { cwd, env: { GIT_TERMINAL_PROMPT: '0' } })
    if (r.exitCode !== 0) return null
    return raw ? r.stdout.replace(/\s+$/, '') : r.stdout.trim()
  } catch {
    return null
  }
}

const dirtyPaths = (status: string) =>
  status
    .split('\n')
    .filter(l => l.length > 3)
    .map(l => {
      const path = l.slice(3)
      const arrow = path.indexOf(' -> ')
      return unquote(arrow === -1 ? path : path.slice(arrow + 4))
    })

const aheadBehind = async ($: EngineInterface, cwd: string): Promise<[number | null, number | null]> => {
  const counts = await git($, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], cwd)
  if (counts === null) return [null, null]
  const [a, b] = counts.split(/\s+/).map(n => Number(n))
  return [a ?? null, b ?? null]
}

/* ---------- the git scan ---------- */

/** A nested repo, or null when its folder is not its own repo here (a worktree does not check them out). */
const scanNested = async ($: EngineInterface, root: string, name: string, rel: string): Promise<Nested | null> => {
  const dir = `${root}/${rel}`
  const top = await git($, ['rev-parse', '--show-toplevel'], dir)
  if (top === null || norm(top).toLowerCase() !== dir.toLowerCase()) return null
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], dir)) ?? '?'
  const status = (await git($, ['status', '--porcelain', '--untracked-files=normal'], dir, true)) ?? ''
  const [ahead, behind] = await aheadBehind($, dir)
  return { name, branch, ahead, behind, dirty: dirtyPaths(status).length }
}

const scanRepo = async ($: EngineInterface): Promise<Repo | null> => {
  const cwd = await $.session.cwd()
  const top = await git($, ['rev-parse', '--show-toplevel'], cwd)
  if (top === null) return null
  const root = norm(top)
  const branch = (await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)) ?? '?'
  const head = (await git($, ['rev-parse', '--short', 'HEAD'], cwd)) ?? ''
  const common = await git($, ['rev-parse', '--git-common-dir'], cwd)
  const mainTree = common === null || common === '.git' || norm(common).toLowerCase() === `${root}/.git`.toLowerCase()
  const status = (await git($, ['status', '--porcelain', '--untracked-files=normal'], cwd, true)) ?? ''
  const [ahead, behind] = await aheadBehind($, cwd)
  const nested = (await Promise.all(NESTED.map(([name, rel]) => scanNested($, root, name, rel)))).filter((n): n is Nested => n !== null)
  return { root, branch, head, tree: mainTree ? null : basename(root), ahead, behind, dirty: dirtyPaths(status), nested }
}

/* ---------- the server scan (Windows) ---------- */

/**
 * Finds every `shopify theme dev` and `hyperframes preview` node process, its
 * ports, the folder it runs from (the `cd` in the shell that started it, or an
 * absolute node_modules path in its command line), and whether it is an
 * orphan: the chain of parents ends in a shell or node process whose own
 * parent is gone, so the session that started it is gone. A node launcher
 * above it (npx, the shopify bin) joins its kill list.
 */
const SCAN = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function KindOf([string]$c) {
  if ($c -match '@shopify[\\/]' -and $c -match '\btheme\s+dev\b') { return 'theme' }
  if ($c -match 'hyperframes' -and $c -match '\bpreview\b') { return 'video' }
  return $null
}
$procs = Get-CimInstance Win32_Process
$byId = @{}
foreach ($p in $procs) { $byId[[int]$p.ProcessId] = $p }
$listen = @(Get-NetTCPConnection -State Listen)
$shells = '^(bash|sh|pwsh|powershell|cmd|node)\.exe$'
$out = New-Object System.Collections.ArrayList
foreach ($p in $procs) {
  if ($p.Name -ne 'node.exe') { continue }
  $kind = KindOf ([string]$p.CommandLine)
  if ($null -eq $kind) { continue }
  $ports = @($listen | Where-Object { $_.OwningProcess -eq $p.ProcessId } | ForEach-Object { [int]$_.LocalPort } | Sort-Object -Unique)
  $kill = New-Object System.Collections.ArrayList
  [void]$kill.Add([int]$p.ProcessId)
  $tree = $null
  $cur = $p
  $top = $p
  for ($i = 0; $i -lt 12; $i++) {
    $c = [string]$cur.CommandLine
    if ($null -eq $tree) {
      if ($c -match 'cd /([a-zA-Z])/([^ &;\x27\x22]+)') { $tree = $Matches[1].ToUpper() + ':/' + $Matches[2] }
      elseif ($c -match 'cd \x22?([A-Za-z]:[\\/][^&;\x27\x22]+?)\x22?\s*(&&|;)') { $tree = $Matches[1] -replace '\\', '/' }
    }
    $par = $byId[[int]$cur.ParentProcessId]
    if ($null -eq $par) { break }
    if ($par.CreationDate -and $cur.CreationDate -and $par.CreationDate -gt $cur.CreationDate) { break }
    if ($par.Name -eq 'node.exe' -and (KindOf ([string]$par.CommandLine)) -eq $kind) { [void]$kill.Add([int]$par.ProcessId) }
    $cur = $par
    $top = $par
  }
  $orphan = [bool]($top.Name -match $shells)
  [void]$out.Add([pscustomobject]@{ pid = [int]$p.ProcessId; kind = $kind; ports = @($ports); tree = $tree; orphan = $orphan; kill = @($kill) })
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 4
`

const isServer = (v: unknown): v is Server =>
  typeof v === 'object' && v !== null && typeof (v as Server).pid === 'number' && ((v as Server).kind === 'theme' || (v as Server).kind === 'video')

const scanServers = async ($: EngineInterface): Promise<Server[]> => {
  const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', SCAN], { timeoutMs: 30000 })
  const text = r.stdout.trim()
  if (r.exitCode !== 0 || text === '') return []
  const parsed: unknown = JSON.parse(text)
  const list = (Array.isArray(parsed) ? parsed : [parsed]).filter(isServer).map(s => ({
    pid: s.pid,
    kind: s.kind,
    ports: Array.isArray(s.ports) ? s.ports : [],
    tree: typeof s.tree === 'string' ? norm(s.tree) : null,
    orphan: s.orphan === true,
    kill: Array.isArray(s.kill) ? s.kill : [s.pid],
  }))
  /* A launcher (npx, the shopify bin) matches too: keep only the process at the bottom of each chain. */
  const launchers = new Set(list.flatMap(s => s.kill.filter(pid => pid !== s.pid)))
  return list.filter(s => !launchers.has(s.pid))
}

/* ---------- refreshes ---------- */

let repoBusy = false
let serversBusy = false
let fetchBusy = false

const refreshRepo = async ($: EngineInterface) => {
  if (repoBusy) return
  repoBusy = true
  try {
    await $.state.set(REPO, await scanRepo($))
  } catch (err) {
    await setNote($, `git scan failed: ${message(err)}`)
  } finally {
    repoBusy = false
  }
}

const refreshServers = async ($: EngineInterface) => {
  if (serversBusy) return
  serversBusy = true
  try {
    await $.state.set(SERVERS, await scanServers($))
    await $.state.set(SCANNED, Date.now())
  } catch (err) {
    await setNote($, `server scan failed: ${message(err)}`)
  } finally {
    serversBusy = false
  }
}

/**
 * Fetches the knowledge base and each nested repo, so ↓ counts what the other
 * station (or the Shopify GitHub bot, for the theme) pushed. A fetch moves no
 * working file; a failure (offline, no credentials) stays quiet.
 */
const refreshFetch = async ($: EngineInterface) => {
  if (fetchBusy) return
  fetchBusy = true
  try {
    const repo = await getRepo($)
    if (repo === null) return
    const dirs = [repo.root, ...NESTED.filter(([name]) => repo.nested.some(n => n.name === name)).map(([, rel]) => `${repo.root}/${rel}`)]
    await Promise.all(dirs.map(d => git($, ['fetch', '--quiet', '--no-tags'], d)))
    await $.state.set(FETCHED, Date.now())
    await refreshRepo($)
  } finally {
    fetchBusy = false
  }
}

/** The context window as /context sees it: used, window, compaction point and the slices. */
const refreshContext = async ($: EngineInterface) => {
  try {
    const u = await $.session.usage({ breakdown: 'summary', columns: 120 })
    const b = u.context.breakdown
    const slices: ContextSlice[] =
      b === undefined
        ? []
        : b.categories
            .filter(c => !c.isDeferred)
            .map(c => ({ name: c.name, tokens: c.tokens, percent: Math.round((c.tokens / Math.max(1, b.maxTokens)) * 100), kind: c.kind }))
    const used = b?.totalTokens ?? u.context.tokens ?? 0
    const window = b?.rawMaxTokens ?? u.context.window
    const limits: Limit[] = u.rateLimits.map(l => {
      const at = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)
      return { kind: l.kind, percent: l.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
    })
    await $.state.set(CONTEXT, { used, window, compactAt: b?.autoCompactThreshold ?? null, slices, limits })
  } catch (err) {
    await setNote($, `context read failed: ${message(err)}`)
  }
}

const refreshAll = ($: EngineInterface) => Promise.all([refreshRepo($), refreshServers($), refreshContext($)])

/** 4.2k, 17k, 90k, 1M: the status line's spelling. */
const fmtTokens = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** One colour per used slice, in /context's row order; free space is dim, the buffer dimmer. */
const SLICE_COLORS = ['#60a5fa', '#2dd4bf', '#a78bfa', '#4ade80', '#fbbf24', '#f472b6', '#fb923c', '#e879f9', '#38bdf8', '#a3e635']
const sliceColor = (i: number) => SLICE_COLORS[i % SLICE_COLORS.length] ?? '#60a5fa'
/** The same colour, mixed 40% towards white: the highlight a hovered segment or gauge takes. */
const lighten = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (m === null) return hex
  const mix = (h: string) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * 0.4).toString(16).padStart(2, '0')
  return `#${mix(m[1] ?? '00')}${mix(m[2] ?? '00')}${mix(m[3] ?? '00')}`
}

/** A circle that fills in quarters: empty, a quarter, half, three quarters, full. */
const gaugeGlyph = (percent: number) => {
  if (percent >= 87.5) return '●'
  if (percent >= 62.5) return '◕'
  if (percent >= 37.5) return '◑'
  if (percent >= 12.5) return '◔'
  return '○'
}
const gaugeColor = (percent: number) => (percent >= 80 ? C.bad : percent >= 50 ? C.warn : C.ok)
const limitShort = (kind: string) => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind.replace(/_/g, ' '))
const limitLong = (kind: string) =>
  kind === 'five_hour' ? 'session limit (5 hours)' : kind === 'seven_day' ? 'weekly limit (7 days)' : `${kind.replace(/_/g, ' ')} limit`

/** "2h 14m", "3d 4h", "12m", or "now" once the moment has passed. */
const untilText = (at: number, now: number) => {
  const s = Math.max(0, Math.round((at - now) / 1000))
  if (s === 0) return 'now'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

/** "21:40": the local clock time a window resets at, for the gauge's own line. */
const clockText = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const limitCaps = (kind: string) => (kind === 'five_hour' ? '5-HOUR' : kind === 'seven_day' ? 'WEEK' : kind.replace(/_/g, ' ').toUpperCase())

/** A ring gauge: a dim track and a coloured arc that covers `percent` of it, clockwise from the top. 44 px square. */
const ringSvg = (percent: number, color: string) => {
  const r = 17
  const circ = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, percent)) / 100 * circ
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">` +
    `<circle cx="22" cy="22" r="${r}" fill="none" stroke="#3a3f4b" stroke-width="6"/>` +
    `<circle cx="22" cy="22" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" ` +
    `stroke-dasharray="${filled.toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 22 22)"/>` +
    `</svg>`
  )
}

const shortName = (name: string) =>
  name
    .toLowerCase()
    .replace(/^system (tools)$/, '$1')
    .replace(/^custom agents$/, 'agents')
    .replace(/^mcp server instructions$/, 'mcp notes')
    .replace(/^autocompact buffer$/, 'buffer')
    .replace(/^free space$/, 'free')

/** The worktree a server runs from, when it is one; nothing for the main tree. */
const serverTree = (s: Server) => /\/\.claude\/worktrees\/([^/]+)/i.exec(s.tree ?? '')?.[1] ?? null

const stopOrphans = async ($: EngineInterface) => {
  const servers = await getServers($)
  const pids = [...new Set(servers.filter(s => s.orphan).flatMap(s => s.kill))]
  await setConfirm($, false)
  if (pids.length === 0) return
  try {
    const r = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `Stop-Process -Id ${pids.join(',')} -Force`], { timeoutMs: 15000 })
    if (r.exitCode === 0) {
      $.ui.toast(`${NAME}: stopped ${pids.length} orphan process${pids.length === 1 ? '' : 'es'}`)
      await setNote($, `stopped orphan pids ${pids.join(', ')}`)
    } else {
      await setNote($, `stop failed: ${r.stderr.trim().split('\n')[0] ?? 'unknown error'}`)
    }
  } catch (err) {
    await setNote($, `stop failed: ${message(err)}`)
  }
  await refreshServers($)
}

/** Pulls the knowledge base, fast-forward only: it never merges, so a pull that would need one stops and says so. */
const pull = async ($: EngineInterface) => {
  const repo = await getRepo($)
  if (repo === null) return
  try {
    const r = await $.process.run(['git', 'pull', '--ff-only', '--quiet'], { cwd: repo.root, env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 60000 })
    if (r.exitCode === 0) {
      $.ui.toast(`${NAME}: pulled ${repo.behind ?? 0} commit${repo.behind === 1 ? '' : 's'}`)
      await setNote($, `pulled ${repo.branch}`)
    } else {
      await setNote($, `pull stopped: ${r.stderr.trim().split('\n')[0] ?? 'unknown error'}`)
    }
  } catch (err) {
    await setNote($, `pull failed: ${message(err)}`)
  }
  await refreshRepo($)
}

/* ---------- the action buttons ---------- */

/** Runs a slash command for Andrei, as if he typed /command; a name the session does not know shows its reason under the band. */
const submit = async ($: EngineInterface, command: string) => {
  try {
    await $.command.run({ command })
  } catch (err) {
    await setNote($, `/${command} failed: ${message(err)}`)
  }
}

/* ---------- mine: what this session edited ---------- */

const noteMine = async ($: EngineInterface, file: string) => {
  if ((await getRepo($)) === null) await refreshRepo($)
  const repo = await getRepo($)
  let rel = norm(file)
  if (repo !== null && rel.toLowerCase().startsWith(repo.root.toLowerCase() + '/')) rel = rel.slice(repo.root.length + 1)
  const key = rel.toLowerCase()
  const mine = await getMine($)
  if (!mine.includes(key)) await $.state.set(MINE, [...mine, key])
}

/** After a shell command: a git command may have moved a tree, a server command may have started or stopped one. */
const afterShell = async ($: EngineInterface, cmd: string) => {
  if (/\bgit\b/.test(cmd)) await refreshRepo($)
  if (/theme\s+dev|hyperframes|Stop-Process|taskkill|\bkill\b/.test(cmd)) {
    try {
      $.clock.after(1500, () => void refreshServers($))
    } catch {}
  }
}

/* ---------- registration ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    active = null
    if (!(await atHome($))) return next(e)
    await $.command.register({
      name: 'castle',
      description: 'nerd-band: show, hide or refresh the band above the prompt; fetch checks GitHub now; forget clears the list of files this session edited',
      argumentHint: 'show|hide|refresh|fetch|forget',
    })
    await refreshRepo($)
    await refreshContext($)
    try {
      $.clock.after(50, () => void refreshServers($))
      $.clock.after(3_000, () => void refreshFetch($))
      $.clock.every(15_000, () => void refreshRepo($))
      $.clock.every(30_000, () => void refreshContext($))
      $.clock.every(45_000, () => void refreshServers($))
      $.clock.every(600_000, () => void refreshFetch($))
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'castle' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hide') {
      await setHidden($, true)
      return { text: 'nerd-band: hidden. /castle show brings it back.' }
    }
    if (arg === 'show') {
      await setHidden($, false)
      return { text: 'nerd-band: shown.' }
    }
    if (arg === 'forget') {
      await $.state.set(MINE, [])
      return { text: 'nerd-band: the list of files this session edited is empty again.' }
    }
    if (arg === 'fetch') await refreshFetch($)
    await refreshAll($)
    const repo = await getRepo($)
    const servers = await getServers($)
    const lines = [
      repo === null ? 'no git tree' : `${repo.branch} @ ${repo.head} on ${repo.tree ?? 'the main tree'} (${repo.dirty.length} dirty, ${repo.behind ?? '?'} behind)`,
      ...(repo?.nested ?? []).map(n => `${n.name}: ${n.branch} (${n.dirty} dirty, ${n.behind ?? '?'} behind)`),
      servers.length === 0 ? 'no theme or video dev server is running' : servers.map(s => `${s.kind} :${s.ports.join('/') || '?'} ${s.tree ?? '?'}${s.orphan ? ' ORPHAN' : ''}`).join('\n'),
    ]
    return { text: lines.join('\n') }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if ((await atHome($)) && ran.deny === undefined && ran.isError === undefined) await noteMine($, e.file_path)
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if ((await atHome($)) && ran.deny === undefined && ran.isError === undefined) await noteMine($, e.file_path)
    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if ((await atHome($)) && ran.deny === undefined && ran.isError === undefined) await noteMine($, e.notebook_path)
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (await atHome($)) await afterShell($, e.command)
    return ran
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const ran = await next(e)
    if (await atHome($)) await afterShell($, e.command)
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (await atHome($)) await Promise.all([refreshRepo($), refreshContext($)])
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await atHome($)) || e.props.hasSurvey || (await getHidden($))) return next(e)
    const repo = await getRepo($)
    const servers = await getServers($)
    const mine = new Set(await getMine($))
    const confirm = await getConfirm($)
    const note = await getNote($)
    const scannedAt = await getScanned($)
    const fetchedAt = await getFetched($)
    const context = await getContext($)
    const { Box, Text, Button } = $.ui.resolve(e)

    /* The context row: a headline, a bar of coloured cells, one legend chip per slice. */
    let contextRow = null
    if (context !== null) {
      const used = context.slices.filter(s => s.kind === 'used' && s.tokens > 0)
      /* The bar has its row to itself: the whole left column less the button column and the padding. */
      const barWidth = Math.max(20, Math.min(90, e.props.bodyColumns - 28))
      let cells = 0
      /* One keyed Box per segment: the pointer on it lightens the blocks and reveals a one-row card under the bar. */
      const bar = used.map((s, i) => {
        const n = Math.max(1, Math.round((s.tokens / Math.max(1, context.window)) * barWidth))
        cells += n
        const color = sliceColor(i)
        return (
          <Box key={`seg${i}`}>
            <Text color={color} hover={{ color: lighten(color) }}>
              {'█'.repeat(n)}
            </Text>
            <Box position="absolute" top={1} left={0} display="none" hover={{ display: 'flex' }} backgroundColor="#1f2937" paddingX={1}>
              <Text color={color} bold>
                ■{' '}
              </Text>
              <Text>
                {shortName(s.name)} · {fmtTokens(s.tokens)} · {s.percent}%
              </Text>
            </Box>
          </Box>
        )
      })
      const rest = Math.max(0, barWidth - cells)
      const pct = Math.round((context.used / Math.max(1, context.window)) * 100)
      const hot = context.compactAt !== null && context.used >= context.compactAt * 0.8
      const now = Date.now()
      const limits = context.limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day' || l.percent > 0)
      /* The desktop draws a real ring; the terminal has no vector leaf, so it draws a circle glyph that fills in quarters. */
      const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : null
      const gauges = limits.map(l => {
        const color = gaugeColor(l.percent)
        const card = (
          <Box position="absolute" top={Svg === null ? 1 : 2} left={0} display="none" hover={{ display: 'flex' }} backgroundColor="#1f2937" paddingX={1}>
            <Text>
              {limitLong(l.kind)} · {l.percent}% of 100% used · {l.resetsAt === null ? 'reset time unknown' : `resets in ${untilText(l.resetsAt, now)}`}
            </Text>
          </Box>
        )
        if (Svg === null) {
          return (
            <Box key={`gauge-${l.kind}`}>
              <Text color={color} hover={{ color: lighten(color), bold: true }}>
                {gaugeGlyph(l.percent)} {limitShort(l.kind)} {Math.round(l.percent)}%
              </Text>
              {card}
            </Box>
          )
        }
        return (
          <Box key={`gauge-${l.kind}`} flexDirection="row" gap={1} alignItems="center">
            <Svg source={ringSvg(l.percent, color)} alt={`${limitLong(l.kind)}: ${l.percent}% used`} width={44} height={44} />
            <Box flexDirection="column">
              <Text dimColor>{limitCaps(l.kind)}</Text>
              <Text>
                <Text bold color={color} hover={{ color: lighten(color) }}>
                  {Math.round(l.percent)}%
                </Text>
                {l.resetsAt !== null ? <Text dimColor> resets {l.kind === 'seven_day' ? untilText(l.resetsAt, now) : clockText(l.resetsAt)}</Text> : null}
              </Text>
            </Box>
            {card}
          </Box>
        )
      })
      contextRow = (
        <Box flexDirection="column">
          <Text>
            <Text color={hot ? C.bad : C.warn} bold>
              ◆ context{' '}
            </Text>
            <Text bold>{fmtTokens(context.used)}</Text>
            <Text dimColor>
              {' '}
              of {fmtTokens(context.window)} · {pct}%
            </Text>
            {context.compactAt !== null ? <Text dimColor> · compacts at {fmtTokens(context.compactAt)}</Text> : null}
          </Text>
          <Box flexDirection="row" flexWrap="nowrap" overflow="hidden">
            {bar}
            <Text dimColor wrap="truncate-end">
              {'░'.repeat(rest)}
            </Text>
          </Box>
          {gauges.length > 0 ? (
            <Box flexDirection="row" gap={3} marginTop={Svg === null ? 0 : 1}>
              {gauges}
            </Box>
          ) : null}
        </Box>
      )
    }

    const others = repo === null ? [] : repo.dirty.filter(p => !mine.has(p.toLowerCase()))
    const mineCount = repo === null ? 0 : repo.dirty.length - others.length
    const orphans = servers.filter(s => s.orphan)
    const behind = repo?.behind ?? 0
    const dot = <Text dimColor> · </Text>

    const gitChips =
      repo === null ? (
        <Text dimColor>no git tree</Text>
      ) : (
        <Text>
          <Text color={C.branch} bold>
            ⎇ {repo.branch}
          </Text>
          <Text dimColor> {repo.head}</Text>
          {dot}
          <Text color={C.tree}>{repo.tree === null ? '⌂ main tree' : `⌂ ${repo.tree}`}</Text>
          {repo.ahead !== null && repo.behind !== null ? (
            <Text>
              {dot}
              <Text color={repo.behind > 0 ? C.warn : C.ok} bold={repo.behind > 0}>
                ↑{repo.ahead} ↓{repo.behind}
              </Text>
            </Text>
          ) : null}
          {dot}
          {repo.dirty.length === 0 ? (
            <Text color={C.ok}>✓ clean</Text>
          ) : (
            <Text>
              <Text color={C.ok}>✎ {mineCount} mine</Text>
              {others.length > 0 ? (
                <Text color={C.bad} bold>
                  {' '}
                  ⚠ {others.length} not mine
                </Text>
              ) : null}
            </Text>
          )}
        </Text>
      )

    const serverChips =
      servers.length === 0 ? (
        <Text dimColor>{scannedAt === 0 ? 'scanning servers…' : 'no dev servers'}</Text>
      ) : (
        <Text>
          {servers.map((s, i) => {
            const tree = serverTree(s)
            return (
              <Text key={`s${s.pid}`}>
                {i > 0 ? dot : null}
                <Text color={s.orphan ? C.bad : s.kind === 'theme' ? C.theme : C.video} bold={s.orphan}>
                  {s.orphan ? '☠ ' : '● '}
                  {s.kind} :{s.ports.join('/') || '?'}
                </Text>
                {tree !== null ? <Text dimColor> {tree}</Text> : null}
              </Text>
            )
          })}
        </Text>
      )

    /* The nested repos: theme, workbench, etsy. A clean, level repo is a quiet green tick. */
    const nestedRow =
      repo === null || repo.nested.length === 0 ? null : (
        <Text wrap="truncate-end">
          {repo.nested.map((n, i) => (
            <Text key={`n-${n.name}`}>
              {i > 0 ? dot : null}
              <Text dimColor>{n.name} </Text>
              <Text color={C.branch}>{n.branch}</Text>
              {n.behind !== null && n.behind > 0 ? (
                <Text color={C.warn} bold>
                  {' '}
                  ↓{n.behind}
                </Text>
              ) : null}
              {n.ahead !== null && n.ahead > 0 ? <Text color={C.warn}> ↑{n.ahead}</Text> : null}
              {n.dirty > 0 ? <Text color={C.warn}> ✎ {n.dirty}</Text> : <Text color={C.ok}> ✓</Text>}
            </Text>
          ))}
          {fetchedAt === 0 ? <Text dimColor> · not fetched yet</Text> : null}
        </Text>
      )

    return (
      <Box key="band" flexDirection="row" paddingX={1} gap={2}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
          {gitChips}
          {behind > 0 ? (
            <Button key="pull" hotkey="l" hover={{ color: C.warn, bold: true }} onPress={() => void pull($)}>
              {`pull ↓${behind}`}
            </Button>
          ) : null}
          <Text dimColor>│</Text>
          {serverChips}
          {orphans.length > 0 ? (
            confirm ? (
              <Box gap={1}>
                <Text color={C.bad} bold>
                  stop {orphans.length} orphan{orphans.length === 1 ? '' : 's'}?
                </Text>
                <Button key="stop-yes" variant="primary" onPress={() => void stopOrphans($)}>
                  yes
                </Button>
                <Button key="stop-no" onPress={() => void setConfirm($, false)}>
                  no
                </Button>
              </Box>
            ) : (
              <Button key="stop" hotkey="s" hover={{ color: C.bad, bold: true }} onPress={() => void setConfirm($, true)}>
                {`stop ${orphans.length} orphan${orphans.length === 1 ? '' : 's'}`}
              </Button>
            )
          ) : null}
        </Box>
        {nestedRow}
        {contextRow}
        {others.length > 0 ? (
          <Text color={C.bad} wrap="truncate-end">
            {'  not mine: '}
            {others.slice(0, 4).join(', ')}
            {others.length > 4 ? ` +${others.length - 4}` : ''}
          </Text>
        ) : null}
        {note !== null ? (
          <Text dimColor wrap="truncate-end">
            {'  '}
            {note}
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="column" flexShrink={0} alignItems="flex-end" justifyContent="space-between" minHeight={6}>
        <Box flexDirection="column" alignItems="flex-end" gap={1}>
          <Button key="compact" hotkey="c" hover={{ color: C.warn, bold: true }} onPress={() => void submit($, 'compact')}>
            compact
          </Button>
          <Button key="ship" hotkey="p" hover={{ color: C.ok, bold: true }} onPress={() => void submit($, 'ship')}>
            ship
          </Button>
          <Button key="review" hotkey="v" hover={{ color: C.branch, bold: true }} onPress={() => void submit($, 'code-review')}>
            review
          </Button>
        </Box>
        <Box gap={1} marginTop={1}>
          <Button key="refresh" dimColor hover={{ color: C.tree }} onPress={() => void refreshAll($)}>
            ↻
          </Button>
          <Button key="hide" dimColor hover={{ color: C.bad }} onPress={() => void setHidden($, true)}>
            ×
          </Button>
        </Box>
      </Box>
      </Box>
    )
  })
}
