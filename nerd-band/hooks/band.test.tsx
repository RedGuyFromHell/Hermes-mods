import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const ROOT = 'D:/Projects/NERD-CASTLE'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 140, scroll: { offset: 0, bodyRows: 13 }, view: {} },
} as const

const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

type Host = {
  cwd?: string
  dirty: string
  /** The knowledge base's "ahead behind" answer. */
  counts?: string
  /** Each nested repo that exists here: its branch, status and counts. */
  nested?: Record<string, { branch: string; dirty: string; counts: string }>
  servers: unknown[]
  /** Every git or PowerShell command that writes: pull, fetch, Stop-Process. */
  writes: string[]
  pullFails?: boolean
}

const USAGE = {
  startedAt: 0,
  rateLimits: [{ kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(Date.now() + 3600_000).toISOString() }],
  context: { tokens: 55_000, window: 1_000_000, percent: 5 },
}

/** Stands for the host: git answers for the knowledge base and its nested repos, the PowerShell scan, the usage figures. */
const fakeHost = (on: On, host: Host) => {
  on('session.cwd', () => ({ value: host.cwd ?? ROOT }))
  on('session.usage', () => ({ value: USAGE as never }))
  on('process.run', (_$, e) => {
    const a = e.argv.join(' ')
    const base = host.cwd ?? ROOT
    const cwd = (e.init?.cwd ?? base).replace(/\\/g, '/')
    const rel = cwd.startsWith(`${base}/`) ? cwd.slice(base.length + 1) : ''
    const nested = host.nested?.[rel]
    if (a.startsWith('git pull') || a.startsWith('git fetch')) {
      host.writes.push(`${a} @ ${rel || 'root'}`)
      return host.pullFails && a.startsWith('git pull') ? fail('fatal: Not possible to fast-forward, aborting.\n') : ok('')
    }
    if (rel !== '') {
      /* A folder that is not its own repo answers with the knowledge base's root. */
      if (nested === undefined) return a.startsWith('git rev-parse --show-toplevel') ? ok(`${base}\n`) : ok('')
      if (a.startsWith('git rev-parse --show-toplevel')) return ok(`${cwd}\n`)
      if (a.startsWith('git rev-parse --abbrev-ref')) return ok(`${nested.branch}\n`)
      if (a.startsWith('git status')) return ok(nested.dirty)
      if (a.startsWith('git rev-list')) return ok(nested.counts)
      return ok('')
    }
    if (a.startsWith('git rev-parse --show-toplevel')) return ok(`${host.cwd ?? ROOT}\n`)
    if (a.startsWith('git rev-parse --abbrev-ref')) return ok('main\n')
    if (a.startsWith('git rev-parse --short')) return ok('408c6c4\n')
    if (a.startsWith('git rev-parse --git-common-dir')) return ok(host.cwd === undefined ? '.git\n' : `${ROOT}/.git\n`)
    if (a.startsWith('git status')) return ok(host.dirty)
    if (a.startsWith('git rev-list')) return ok(host.counts ?? '0\t0\n')
    if (a.includes('Stop-Process')) {
      host.writes.push(a)
      return ok('')
    }
    if (a.includes('ConvertTo-Json')) return ok(JSON.stringify(host.servers))
    return ok('')
  })
}

const THEME = { 'store/Nerd-Castle-Liquid': { branch: 'Copy/Statue-Page', dirty: '', counts: '0\t3\n' } }

for (const surface of SURFACES) {
  test(`the band shows the branch, my edits, the files that are not mine and the nested repos (${surface})`, async ($, on) => {
    fakeHost(on, {
      dirty: '?? store/scripts/privacy-body-backup-2026-10-02.en.html\n M business/projects/_index.md\n',
      nested: { ...THEME, 'tools/workbench': { branch: 'master', dirty: ' M main.py\n', counts: '0\t0\n' } },
      servers: [],
      writes: [],
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
    await $.command.run({ command: 'castle', args: 'refresh', ...typed })
    await $.tool.call({ tool: 'Edit', file_path: 'D:\\Projects\\NERD-CASTLE\\business\\projects\\_index.md', old_string: 'a', new_string: 'b' })
    const ui = await $.ui.mount({ plugin: 'nerd-band', surface, ...BAND })
    expect(await ui.find({ text: /⎇ main/ })).toBeDefined()
    expect(await ui.find({ text: /main tree/ })).toBeDefined()
    expect(await ui.find({ text: /1 mine/ })).toBeDefined()
    expect(await ui.find({ text: /1 not mine/ })).toBeDefined()
    expect(await ui.find({ text: /privacy-body-backup-2026-10-02\.en\.html/ })).toBeDefined()
    expect(await ui.find({ text: /^theme $/ })).toBeDefined()
    expect(await ui.find({ text: /Copy\/Statue-Page/ })).toBeDefined()
    expect(await ui.find({ text: /↓3/ })).toBeDefined()
    expect(await ui.find({ text: /✎ 1/ })).toBeDefined()
    expect(await ui.find({ text: /^etsy $/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('outside the knowledge base the band draws nothing and runs nothing', async ($, on) => {
  const host: Host = { cwd: 'D:/Projects/HERMES', dirty: '', servers: [], writes: [] }
  fakeHost(on, host)
  let passedOn = false
  try {
    const ui = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
    await ui.unmount()
  } catch (err) {
    passedOn = /no implementation for ui.render/.test(String(err))
  }
  expect(passedOn).toBe(true)
})

test('a worktree shows its name and no nested repos', async ($, on) => {
  fakeHost(on, { cwd: `${ROOT}/.claude/worktrees/brave-otter`, dirty: '', servers: [], writes: [] })
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /⌂ brave-otter/ })).toBeDefined()
  expect(await ui.find({ text: /^theme $/ })).toBeUndefined()
  await ui.unmount()
})

test('a pull button shows when the other station pushed, and pulls fast-forward only', async ($, on) => {
  const host: Host = { dirty: '', counts: '0\t2\n', servers: [], writes: [] }
  fakeHost(on, host)
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /↑0 ↓2/ })).toBeDefined()
  expect(await ui.find({ key: 'pull' })).toBeDefined()
  host.counts = '0\t0\n'
  await ui.press({ key: 'pull' })
  expect(host.writes).toEqual(['git pull --ff-only --quiet @ root'])
  expect(await ui.find({ key: 'pull' })).toBeUndefined()
  expect(await ui.find({ text: /pulled main/ })).toBeDefined()
  await ui.unmount()
})

test('a pull that needs a merge stops and says why under the band', async ($, on) => {
  fakeHost(on, { dirty: '', counts: '1\t2\n', servers: [], writes: [], pullFails: true })
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
  await ui.press({ key: 'pull' })
  expect(await ui.find({ text: /pull stopped: fatal: Not possible to fast-forward/ })).toBeDefined()
  expect(await ui.find({ key: 'pull' })).toBeDefined()
  await ui.unmount()
})

test('/castle fetch fetches the knowledge base and each nested repo, never the missing ones', async ($, on) => {
  const host: Host = { dirty: '', nested: THEME, servers: [], writes: [] }
  fakeHost(on, host)
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  await $.command.run({ command: 'castle', args: 'fetch', ...typed })
  expect(host.writes.sort()).toEqual(['git fetch --quiet --no-tags @ root', 'git fetch --quiet --no-tags @ store/Nerd-Castle-Liquid'])
})

test('the theme and video servers show with their ports; a launcher above a server is not a second server', async ($, on) => {
  fakeHost(on, {
    dirty: '',
    servers: [
      { pid: 21, kind: 'theme', ports: [9292], tree: `${ROOT}/store/Nerd-Castle-Liquid`, orphan: false, kill: [21, 20] },
      { pid: 20, kind: 'theme', ports: [], tree: null, orphan: false, kill: [20] },
      { pid: 31, kind: 'video', ports: [3002], tree: `${ROOT}/.claude/worktrees/brave-otter/business/marketing/video`, orphan: false, kill: [31] },
    ],
    writes: [],
  })
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'nerd-band', surface: 'desktop', ...BAND })
  expect(await ui.find({ text: /theme :9292/ })).toBeDefined()
  expect(await ui.find({ text: /theme :\?/ })).toBeUndefined()
  expect(await ui.find({ text: /video :3002/ })).toBeDefined()
  expect(await ui.find({ text: /brave-otter/ })).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  await ui.unmount()
})

test('an orphan server gets a stop button that asks first, then stops it and its launcher', async ($, on) => {
  const host: Host = {
    dirty: '',
    servers: [{ pid: 21, kind: 'theme', ports: [9292], tree: null, orphan: true, kill: [21, 20] }],
    writes: [],
  }
  fakeHost(on, host)
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
  await ui.press({ key: 'stop' })
  expect(host.writes).toEqual([])
  host.servers = []
  await ui.press({ key: 'stop-yes' })
  expect(host.writes).toEqual(['powershell -NoProfile -NonInteractive -Command Stop-Process -Id 21,20 -Force'])
  expect(await ui.find({ text: /stopped orphan pids 21, 20/ })).toBeDefined()
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`the compact, ship and review buttons run their slash command (${surface})`, async ($, on) => {
    fakeHost(on, { dirty: '', servers: [], writes: [] })
    const ran: string[] = []
    for (const command of ['compact', 'ship', 'code-review']) {
      on('command.run', { command }, (_$, e) => {
        ran.push(`/${e.command}${e.origin.kind === 'plugin' ? ` by ${e.origin.name}` : ''}`)
        return { text: 'done' }
      })
    }
    await $.command.run({ command: 'castle', args: 'refresh', ...typed })
    const ui = await $.ui.mount({ plugin: 'nerd-band', surface, ...BAND })
    await ui.press({ key: 'compact' })
    await ui.press({ key: 'ship' })
    await ui.press({ key: 'review' })
    expect(ran).toEqual(['/compact by nerd-band', '/ship by nerd-band', '/code-review by nerd-band'])
    await ui.unmount()
  })
}

test('/castle hide empties the band and /castle show brings it back', async ($, on) => {
  fakeHost(on, { dirty: '', servers: [], writes: [] })
  await $.command.run({ command: 'castle', args: 'refresh', ...typed })
  await $.command.run({ command: 'castle', args: 'hide', ...typed })
  let passedOn = false
  try {
    const hidden = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
    await hidden.unmount()
  } catch (err) {
    passedOn = /no implementation for ui.render/.test(String(err))
  }
  expect(passedOn).toBe(true)
  await $.command.run({ command: 'castle', args: 'show', ...typed })
  const shown = await $.ui.mount({ plugin: 'nerd-band', surface: 'terminal', ...BAND })
  expect(await shown.find({ text: /⎇ main/ })).toBeDefined()
  await shown.unmount()
})
