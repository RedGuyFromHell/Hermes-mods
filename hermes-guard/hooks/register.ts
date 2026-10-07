import type { EngineInterface, Register } from 'claude-code'

const NAME = 'hermes-guard'

/* ---------- what the rules look at ---------- */

const norm = (p: string) => p.replace(/\\/g, '/')

/** The verified-path hands-off list (CLAUDE.md): stock spine, eMAG publish, credit ledger. */
const HANDS_OFF: readonly RegExp[] = [
  /apps\/api\/src\/modules\/stock\/(adjustStock|allocateStock|warehouseMath|stockLock|stockEffects|warehouses|math)\.ts$/,
  /apps\/api\/src\/modules\/stock\/sync\/emagSync\.ts$/,
  /apps\/api\/src\/modules\/catalog\/import\/importProducts\.ts$/,
  /apps\/api\/src\/modules\/listings\/listings\.ts$/,
  /apps\/api\/src\/systems\/billing-ledger\/billing\.ts$/,
]
const isHandsOff = (file: string) => HANDS_OFF.some(r => r.test(file))
/** The same list, loose enough to spot a path inside a shell command. */
const HANDS_OFF_IN_CMD: readonly RegExp[] = HANDS_OFF.map(r => new RegExp(r.source.replace(/\$$/, '')))

/** Where check:ui's dash rule looks: app source, not the knowledge base. */
const APP_SRC = /(apps\/(web|api)\/src|packages\/shared\/src)\/.*\.(ts|tsx|css|js|mjs)$/
const DASH = /[–—]/
const TEST_FILE = /\.test\.tsx?$/
const SKIP = /\b(describe|it|test)\.(skip|only)\s*\(|\bx(it|describe|test)\s*\(/g
const countSkips = (s: string) => (s.match(SKIP) ?? []).length

/** A staged file the health gate covers. Anything else (docs, records) may commit without it. */
const CODE_PATH = /^(apps|packages|checks)\/|^(package\.json|tsconfig[^/]*\.json|eslint\.config\.mjs|vitest\.config\.ts|pnpm-workspace\.yaml|pnpm-lock\.yaml)$/

/** One shell segment: up to the next pipe, semicolon, ampersand or newline. */
const SEG = '[^|;&\\n]*'
const GIT_ADD_ALL = new RegExp(`\\bgit\\b${SEG}\\badd\\b${SEG}(\\s-[a-zA-Z]*A|\\s--all\\b|\\s-u\\b|\\s\\.(\\s|$))`)
const GIT_COMMIT_ALL = new RegExp(`\\bgit\\b${SEG}\\bcommit\\b${SEG}(\\s-[a-zA-Z]*a[a-zA-Z]*\\b|\\s--all\\b)`)
const GIT_COMMIT = new RegExp(`\\bgit\\b${SEG}\\bcommit\\b`)
const RM_TEST = new RegExp(`\\b(rm|del|Remove-Item|git${SEG}rm)\\b${SEG}\\.test\\.tsx?\\b`)
const SHELL_WRITE = /\bsed\b[^|;&\n]*\s-i|\btee\b|(^|[^>&\d])>(?!>?\s*(\/dev\/null|&|\$null))|\bSet-Content\b|\bOut-File\b|\b(rm|mv|cp)\b|\bgit\s+(checkout|restore)\b/

const GATE_CMD = /checks[\\/]check\.mjs|\bcheck\.cmd\b|pnpm\s+(run\s+)?check\b/
const GATE_STEP = /--(ui|deps|sections|idioms|routes|privacy|hatches|console|lint|tests|typecheck|mutation)\b/
const GREEN = /All checks passed in \d/

/* ---------- state kept in the store ---------- */

const UNLOCK_KEY = `${NAME}:unlock`
const greenKey = (root: string) => `${NAME}:green:${root}`

const isUnlocked = async ($: EngineInterface) =>
  (await $.store.get(UNLOCK_KEY)) === (await $.session.id())

const unquote = (s: string) => s.replace(/^["']|["']$/g, '')

const shellCwd = (cmd: string): string | undefined => {
  const c = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(cmd) ?? /(?:^|&&|;)\s*cd\s+("[^"]+"|'[^']+'|\S+)/.exec(cmd)
  const found = c?.[1]
  return found === undefined ? undefined : unquote(found)
}

/** The repo root the gate was run for; the session cwd when git cannot say. */
const repoRoot = async ($: EngineInterface, cwd?: string): Promise<string> => {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--show-toplevel'], cwd ? { cwd } : undefined)
    if (r.exitCode === 0 && r.stdout.trim()) return norm(r.stdout.trim())
  } catch {}
  return norm(cwd ?? (await $.session.cwd()))
}

const lastGreen = async ($: EngineInterface, root: string): Promise<number | undefined> => {
  const v = await $.store.get(greenKey(root))
  return typeof v === 'number' ? v : undefined
}

const showStatus = async ($: EngineInterface) => {
  const root = await repoRoot($)
  const at = await lastGreen($, root)
  const unlocked = await isUnlocked($)
  const gate = at === undefined ? 'gate: not run' : `gate ok ${new Date(at).toTimeString().slice(0, 5)}`
  $.ui.status(unlocked ? `${gate} | hands-off UNLOCKED` : gate)
}

/* ---------- the rules ---------- */

const refuseEdit = async ($: EngineInterface, file: string, oldText: string, newText: string): Promise<string | undefined> => {
  if (isHandsOff(file) && !(await isUnlocked($))) {
    $.ui.toast(`${NAME}: refused an edit to a hands-off path`)
    return `${NAME}: ${file} is on the verified-path hands-off list (CLAUDE.md). It needs Andrei's explicit sign-off. Ask him; he can run /guard unlock for this session.`
  }
  if (TEST_FILE.test(file) && countSkips(newText) > countSkips(oldText)) {
    return `${NAME}: this edit adds .skip( or .only( to a test. Never weaken a test to make a change pass (CLAUDE.md, T30 C16). Report the failure instead.`
  }
  if (APP_SRC.test(file) && DASH.test(newText)) {
    return `${NAME}: the new text holds an em or en dash. App source takes none (check:ui). Rewrite the sentence; do not swap in a hyphen.`
  }
  return undefined
}

const refuseCommit = async ($: EngineInterface, cmd: string): Promise<string | undefined> => {
  if (GIT_COMMIT_ALL.test(cmd)) {
    return `${NAME}: git commit -a stages everything. Stage by explicit path (git-and-pr.md); a sibling session may have work in this tree.`
  }
  const root = await repoRoot($, shellCwd(cmd))
  let staged: string[]
  try {
    const r = await $.process.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root })
    if (r.exitCode !== 0) return undefined
    staged = r.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  } catch {
    return undefined
  }
  const code = staged.filter(p => CODE_PATH.test(p))
  if (code.length === 0) return undefined
  const green = await lastGreen($, root)
  if (green === undefined) {
    return `${NAME}: no green health gate on record for this tree. Run node checks/check.mjs, see "All checks passed", then commit.`
  }
  const stale: string[] = []
  for (const p of code) {
    try {
      const st = await $.fs.stat(`${root}/${p}`)
      if (st.mtimeMs > green) stale.push(p)
    } catch {}
  }
  if (stale.length > 0) {
    const more = stale.length > 6 ? ` (+${stale.length - 6})` : ''
    return `${NAME}: edited after the last green gate: ${stale.slice(0, 6).join(', ')}${more}. Run node checks/check.mjs again, then commit.`
  }
  return undefined
}

const refuseShell = async ($: EngineInterface, cmd: string): Promise<string | undefined> => {
  if (GIT_ADD_ALL.test(cmd)) {
    return `${NAME}: stage by explicit path, never git add -A / --all / . / -u (git-and-pr.md). A sibling session may have uncommitted work in this tree.`
  }
  if (RM_TEST.test(cmd)) {
    return `${NAME}: this removes a test file. Never delete or skip a test to make a change pass. Report the failure instead.`
  }
  if (SHELL_WRITE.test(cmd) && HANDS_OFF_IN_CMD.some(r => r.test(norm(cmd))) && !(await isUnlocked($))) {
    return `${NAME}: this command writes to a verified-path hands-off file (CLAUDE.md). It needs Andrei's sign-off; he can run /guard unlock for this session.`
  }
  if (GIT_COMMIT.test(cmd)) return refuseCommit($, cmd)
  return undefined
}

/** After a shell command: a full gate that printed its pass line marks this tree green. */
const noteShell = async ($: EngineInterface, cmd: string, text: string | undefined) => {
  if (text === undefined || !GREEN.test(text) || !/check/i.test(cmd)) return
  if (GATE_CMD.test(cmd) && GATE_STEP.test(cmd)) return
  const root = await repoRoot($, shellCwd(cmd))
  await $.store.set(greenKey(root), Date.now())
  $.ui.toast(`${NAME}: gate green, code commits open`)
  await showStatus($)
}

/* ---------- registration ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard',
      description: 'hermes-guard: status, or unlock / lock the hands-off paths for this session',
      argumentHint: 'status|unlock|lock',
    })
    await showStatus($)
    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'unlock') {
      await $.store.set(UNLOCK_KEY, await $.session.id())
      await showStatus($)
      return { text: 'hermes-guard: hands-off paths UNLOCKED for this session. /guard lock closes them again.' }
    }
    if (arg === 'lock') {
      await $.store.delete(UNLOCK_KEY)
      await showStatus($)
      return { text: 'hermes-guard: hands-off paths locked.' }
    }
    const root = await repoRoot($)
    const at = await lastGreen($, root)
    const lines = [
      `hermes-guard on ${root}`,
      at === undefined ? 'gate: not run for this tree (a commit of code is refused)' : `gate: green at ${new Date(at).toLocaleString()}`,
      `hands-off paths: ${(await isUnlocked($)) ? 'UNLOCKED this session' : 'locked'}`,
      'rules: stage by path, no commit -a, green gate before a code commit, no test skip or delete, no dashes in app source, Agent runs on sonnet (Plan on opus)',
    ]
    return { text: lines.join('\n') }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const why = await refuseEdit($, norm(e.file_path), e.old_string, e.new_string)
    return why === undefined ? next(e) : { deny: why }
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const file = norm(e.file_path)
    let before = ''
    if (TEST_FILE.test(file)) {
      try {
        before = await $.fs.read(file)
      } catch {}
    }
    const why = await refuseEdit($, file, before, e.content)
    return why === undefined ? next(e) : { deny: why }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const why = await refuseShell($, e.command)
    if (why !== undefined) return { deny: why }
    const ran = await next(e)
    await noteShell($, e.command, ran.deny === undefined && ran.isError === undefined ? ran.text : undefined)
    return ran
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const why = await refuseShell($, e.command)
    if (why !== undefined) return { deny: why }
    const ran = await next(e)
    await noteShell($, e.command, ran.deny === undefined && ran.isError === undefined ? ran.text : undefined)
    return ran
  })

  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    if (e.model !== undefined || e.subagent_type === 'fork') return next(e)
    const model = e.subagent_type === 'Plan' ? 'opus' : 'sonnet'
    $.ui.toast(`${NAME}: Agent (${e.subagent_type ?? 'general-purpose'}) runs on ${model}`)
    return next({ ...e, model })
  })
}
