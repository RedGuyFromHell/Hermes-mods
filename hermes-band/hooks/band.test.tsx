import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 14, bodyColumns: 140, scroll: { offset: 0, bodyRows: 13 }, view: {} },
} as const

const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

type Host = { dirty: string; servers: unknown[]; stops: string[] }

const category = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' | 'deferred' = 'used') => ({ name, tokens, color: 'inactive', isDeferred: kind === 'deferred', kind })

/** The usage answer the engine would give: 90k of a 1M window, compaction at 900k. */
const USAGE = {
  startedAt: 0,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: new Date(Date.now() + (2 * 3600 + 14 * 60) * 1000 + 30_000).toISOString() },
    { kind: 'seven_day', percentUsed: 7, resetsAt: new Date(Date.now() + (3 * 86400 + 4 * 3600) * 1000 + 30_000).toISOString() },
  ],
  context: {
    tokens: 90_000,
    window: 1_000_000,
    percent: 9,
    breakdown: {
      categories: [
        category('System prompt', 4_200),
        category('System tools', 17_000),
        category('MCP tools', 52_000),
        category('Custom agents', 3_400),
        category('Memory files', 8_600),
        category('Skills', 5_100),
        category('Messages', 0),
        category('Deferred tools', 30_000, 'deferred'),
        category('Free space', 897_000, 'free'),
        category('Autocompact buffer', 100_000, 'buffer'),
      ],
      totalTokens: 90_300,
      maxTokens: 1_000_000,
      rawMaxTokens: 1_000_000,
      autocompactSource: 'model' as never,
      percentage: 9,
      gridRows: [],
      model: 'claude-fable-5-1',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      autoCompactThreshold: 900_000,
    },
  },
}

/** Stands for the host: git answers, the PowerShell scan, Stop-Process, the usage figures. */
const fakeHost = (on: On, host: Host) => {
  /* Stands for the engine's own band, beneath every mod: the band draws above what it drew. */
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['beneath'] }))
  on('session.cwd', () => ({ value: 'D:/Projects/HERMES' }))
  on('session.usage', () => ({ value: USAGE as never }))
  on('process.run', (_$, e) => {
    const a = e.argv.join(' ')
    if (a.startsWith('git rev-parse --show-toplevel')) return ok('D:/Projects/HERMES\n')
    if (a.startsWith('git rev-parse --abbrev-ref')) return ok('t129-run-record\n')
    if (a.startsWith('git rev-parse --short')) return ok('abc1234\n')
    if (a.startsWith('git rev-parse --git-common-dir')) return ok('.git\n')
    if (a.startsWith('git status')) return ok(host.dirty)
    if (a.startsWith('git rev-list')) return ok('2\t1\n')
    if (a.includes('Stop-Process')) {
      host.stops.push(a)
      return ok('')
    }
    if (a.includes('ConvertTo-Json')) return ok(JSON.stringify(host.servers))
    return ok('')
  })
}

for (const surface of SURFACES) {
  test(`the band shows the branch, my edits and the files that are not mine (${surface})`, async ($, on) => {
    fakeHost(on, { dirty: ' M apps/api/src/index.ts\n?? docs/new.md\nR  old.md -> docs/moved.md\n', servers: [], stops: [] })
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
    await $.command.run({ command: 'band', args: 'refresh', ...typed })
    await $.tool.call({ tool: 'Edit', file_path: 'D:\\Projects\\HERMES\\apps\\api\\src\\index.ts', old_string: 'a', new_string: 'b' })
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface, ...BAND })
    expect(await ui.find({ text: /t129-run-record/ })).toBeDefined()
    expect(await ui.find({ text: /main tree/ })).toBeDefined()
    expect(await ui.find({ text: /↑2 ↓1/ })).toBeDefined()
    expect(await ui.find({ text: /1 mine/ })).toBeDefined()
    expect(await ui.find({ text: /2 not mine/ })).toBeDefined()
    expect(await ui.find({ text: /docs\/new\.md, docs\/moved\.md/ })).toBeDefined()
    await ui.unmount()
  })
}

test('/band forget drops my edits, /band hide empties the band and /band show brings it back', async ($, on) => {
  fakeHost(on, { dirty: ' M apps/api/src/index.ts\n', servers: [], stops: [] })
  on('tool.call', { tool: 'Write' }, () => ({ result: {} as never }))
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  await $.tool.call({ tool: 'Write', file_path: 'D:/Projects/HERMES/apps/api/src/index.ts', content: 'x' })
  const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /1 mine/ })).toBeDefined()
  /* What the engine drew beneath comes last: the band sits above it. */
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text ?? ''))
  expect(texts.indexOf('beneath')).toBe(texts.length - 1)
  await $.command.run({ command: 'band', args: 'forget', ...typed })
  expect(await ui.find({ text: /1 not mine/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'band', args: 'hide', ...typed })
  /* Hidden, the band passes on: only what the engine drew beneath is there. */
  const hidden = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await hidden.find({ text: /^beneath$/ })).toBeDefined()
  expect(await hidden.find({ text: /t129-run-record|not mine/ })).toBeUndefined()
  await hidden.unmount()
  await $.command.run({ command: 'band', args: 'show', ...typed })
  const shown = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await shown.find({ text: /t129-run-record/ })).toBeDefined()
  await shown.unmount()
})

test('an orphan server gets a stop button that asks first, then stops the server and its watcher', async ($, on) => {
  const host: Host = {
    dirty: '',
    servers: [
      { pid: 11, kind: 'api', ports: [3062], tree: 'D:/Projects/hermes-x', orphan: true, kill: [11, 10] },
      { pid: 12, kind: 'web', ports: [5262], tree: 'D:/Projects/hermes-x', orphan: false, kill: [12] },
    ],
    stops: [],
  }
  fakeHost(on, host)
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /api :3062/ })).toBeDefined()
  expect(await ui.find({ text: /web :5262/ })).toBeDefined()
  expect(await ui.find({ text: /hermes-x/ })).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeDefined()
  await ui.press({ key: 'stop' })
  expect(host.stops).toEqual([])
  expect(await ui.find({ key: 'stop-yes' })).toBeDefined()
  await ui.press({ key: 'stop-no' })
  expect(await ui.find({ key: 'stop-yes' })).toBeUndefined()
  await ui.press({ key: 'stop' })
  host.servers = [host.servers[1]]
  await ui.press({ key: 'stop-yes' })
  expect(host.stops).toHaveLength(1)
  expect(host.stops[0]).toMatch(/Stop-Process -Id 11,10 -Force/)
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  expect(await ui.find({ text: /stopped orphan pids 11, 10/ })).toBeDefined()
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`the context row shows used of window, the compaction point and one chip per used slice (${surface})`, async ($, on) => {
    fakeHost(on, { dirty: '', servers: [], stops: [] })
    await $.command.run({ command: 'band', args: 'refresh', ...typed })
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface, ...BAND })
    expect(await ui.find({ text: /◆ context 90k of 1M · 9% · compacts at 900k/ })).toBeDefined()
    expect((await ui.findAll({ text: /^█+$/ })).length).toBe(6)
    expect(await ui.find({ text: /^system prompt · 4\.2k · 0%$/ })).toBeDefined()
    expect(await ui.find({ text: /^mcp tools · 52k · 5%$/ })).toBeDefined()
    expect(await ui.find({ text: /messages/ })).toBeUndefined()
    expect(await ui.find({ text: /deferred/ })).toBeUndefined()
    if (surface === 'terminal') {
      expect(await ui.find({ text: /^◔ 5h 24%$/ })).toBeDefined()
      expect(await ui.find({ text: /^○ 7d 7%$/ })).toBeDefined()
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(0)
    } else {
      const rings = await ui.findAll({ type: 'Svg' })
      expect(rings.length).toBe(2)
      expect(String(rings[0]?.props['source'])).toMatch(/stroke-dasharray="25\.10 106\.81"/)
      expect(await ui.find({ text: /^5-HOUR$/ })).toBeDefined()
      expect(await ui.find({ text: /^WEEK$/ })).toBeDefined()
      expect(await ui.find({ text: /^24% resets \d\d:\d\d$/ })).toBeDefined()
      expect(await ui.find({ text: /^7% resets 3d 4h$/ })).toBeDefined()
    }
    expect(await ui.find({ text: /^session limit \(5 hours\) · 23\.5% of 100% used · resets in 2h 14m$/ })).toBeDefined()
    expect(await ui.find({ text: /^weekly limit \(7 days\) · 7% of 100% used · resets in 3d 4h$/ })).toBeDefined()
    await ui.unmount()
  })
}

test('a server with no orphan shows no stop button', async ($, on) => {
  fakeHost(on, { dirty: '', servers: [{ pid: 12, kind: 'web', ports: [5173], tree: null, orphan: false, kill: [12] }], stops: [] })
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'desktop', ...BAND })
  expect(await ui.find({ text: /web :5173/ })).toBeDefined()
  expect(await ui.find({ key: 'stop' })).toBeUndefined()
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`the compact, ship and review buttons run their slash command (${surface})`, async ($, on) => {
    fakeHost(on, { dirty: '', servers: [], stops: [] })
    const ran: string[] = []
    for (const command of ['compact', 'ship', 'clean-code-review']) {
      on('command.run', { command }, (_$, e) => {
        ran.push(`/${e.command}${e.origin.kind === 'plugin' ? ` by ${e.origin.name}` : ''}`)
        return { text: 'done' }
      })
    }
    await $.command.run({ command: 'band', args: 'refresh', ...typed })
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface, ...BAND })
    expect(await ui.find({ key: 'guard' })).toBeUndefined()
    await ui.press({ key: 'compact' })
    await ui.press({ key: 'ship' })
    await ui.press({ key: 'review' })
    expect(ran).toEqual(['/compact by hermes-band', '/ship by hermes-band', '/clean-code-review by hermes-band'])
    await ui.unmount()
  })
}

test('a slash command the session does not know shows its reason under the band', async ($, on) => {
  fakeHost(on, { dirty: '', servers: [], stops: [] })
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  await ui.press({ key: 'review' })
  expect(await ui.find({ text: /\/clean-code-review failed: / })).toBeDefined()
  await ui.unmount()
})

test('the band yields to a survey: it draws nothing, so the engine draws', async ($, on) => {
  fakeHost(on, { dirty: '', servers: [], stops: [] })
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ text: /^beneath$/ })).toBeDefined()
  expect(await ui.find({ text: /t129-run-record|context/ })).toBeUndefined()
  await ui.unmount()
})

test('in the Nerd Castle knowledge base the band steps aside for nerd-band and runs no git scan', async ($, on) => {
  const runs: string[] = []
  on('session.cwd', () => ({ value: 'D:/Projects/NERD-CASTLE/.claude/worktrees/x' }))
  on('session.usage', () => ({ value: USAGE as never }))
  on('process.run', (_$, e) => {
    runs.push(e.argv.join(' '))
    return ok('')
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never }))
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  let passedOn = false
  try {
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
    await ui.unmount()
  } catch (err) {
    passedOn = /no implementation for ui.render/.test(String(err))
  }
  expect(passedOn).toBe(true)
  expect(runs).toEqual([])
})

for (const surface of SURFACES) {
  test(`the agents chip sits beside the gauges with savvy-progress's counts, and opens its pane (${surface})`, async ($, on) => {
    fakeHost(on, { dirty: '', servers: [], stops: [] })
    on('state.get', { plugin: 'savvy-progress', key: 'agents' }, () => ({ value: { value: [{ status: 'running' }, { status: 'running' }, { status: 'done' }], version: 1 } }))
    const ran: string[] = []
    on('command.run', { command: 'agents-info' }, (_$, e) => {
      ran.push(e.command)
      return { text: 'opened' }
    })
    await $.command.run({ command: 'band', args: 'refresh', ...typed })
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface, ...BAND })
    expect(await ui.find({ text: /^2 running$/ })).toBeDefined()
    expect(await ui.find({ text: /^1 done$/ })).toBeDefined()
    expect(await ui.find({ text: /failed/ })).toBeUndefined()
    if (surface === 'terminal') {
      expect(await ui.find({ text: /^◈ agents $/ })).toBeDefined()
    } else {
      expect(await ui.find({ text: /^AGENTS$/ })).toBeDefined()
      expect((await ui.findAll({ type: 'Svg' })).length).toBe(3)
    }
    await ui.press({ key: 'agents-open' })
    expect(ran).toEqual(['agents-info'])
    await ui.unmount()
  })
}

test('without savvy-progress the band draws no agents chip', async ($, on) => {
  fakeHost(on, { dirty: '', servers: [], stops: [] })
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await ui.find({ text: /◈ agents|no agents yet/ })).toBeUndefined()
  expect(await ui.find({ key: 'agents-open' })).toBeUndefined()
  await ui.unmount()
})

/** The branch's PR as hermes-pr publishes it: two red chips, the billing text under them. */
const PR_344 = {
  number: 344,
  url: 'https://github.com/RedGuyFromHell/Hermes/pull/344',
  title: 'feat(ship): the Clean Historian opens the PR with gh',
  state: 'open' as const,
  base: 'main',
  head: 'ship-via-gh',
  lines: [
    { ok: false, text: 'CI failed: check', detail: 'The job was not started because recent account payments have failed' },
    { ok: true, text: 'no conflicts with main', detail: null },
    { ok: false, text: '9 behind main', detail: null },
    { ok: true, text: 'clear of the other open PRs', detail: null },
    { ok: true, text: 'review: none required', detail: null },
  ],
}

for (const surface of SURFACES) {
  test(`with hermes-pr loaded the PR band sits above the band with its buttons; merge and close ask first, fix PR runs /pr fix (${surface})`, async ($, on) => {
    fakeHost(on, { dirty: '', servers: [], stops: [] })
    on('state.get', { plugin: 'hermes-pr', key: 'pr' }, () => ({ value: { value: PR_344, version: 1 } }))
    on('state.get', { plugin: 'hermes-pr', key: 'fix' }, () => ({ value: { value: 'Fix PR #344: CI failed: check', version: 1 } }))
    const ran: string[] = []
    on('command.run', { command: 'pr' }, (_$, e) => {
      ran.push(`/pr ${e.args}`.trim())
      return { text: 'done' }
    })
    on('prompt.submit', (_$, e) => {
      ran.push(`prompt: ${e.text}`)
      return { text: e.text }
    })
    await $.command.run({ command: 'band', args: 'refresh', ...typed })
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface, ...BAND })
    expect(await ui.find({ key: 'pr-band' })).toBeDefined()
    expect(await ui.find({ text: /#344/ })).toBeDefined()
    expect(await ui.find({ text: /open on GitHub/ })).toBeDefined()
    expect(await ui.find({ key: 'pr-dismiss' })).toBeUndefined()
    expect(await ui.find({ text: /CI failed: check/ })).toBeDefined()
    expect(await ui.find({ text: /payments have failed/ })).toBeDefined()
    expect(await ui.find({ text: /9 behind main/ })).toBeDefined()
    expect(await ui.find({ text: /review: none required/ })).toBeDefined()
    expect(await ui.find({ key: 'merge' })).toBeDefined()
    expect(await ui.find({ key: 'fix' })).toBeDefined()
    expect(await ui.find({ key: 'close-pr' })).toBeDefined()
    await ui.press({ key: 'merge' })
    expect(await ui.find({ text: /merge #344 into main with 2 red\?/ })).toBeDefined()
    await ui.press({ key: 'pr-no' })
    expect(ran).toEqual([])
    await ui.press({ key: 'merge' })
    await ui.press({ key: 'pr-yes' })
    expect(ran).toEqual(['/pr merge'])
    await ui.press({ key: 'fix' })
    expect(ran).toEqual(['/pr merge', 'prompt: Fix PR #344: CI failed: check'])
    expect(await ui.find({ text: /fix PR: sent to the session/ })).toBeDefined()
    await ui.press({ key: 'close-pr' })
    expect(await ui.find({ text: /close #344\?/ })).toBeDefined()
    await ui.press({ key: 'pr-yes' })
    expect(ran).toEqual(['/pr merge', 'prompt: Fix PR #344: CI failed: check', '/pr close'])
    await ui.press({ key: 'pr-reload' })
    expect(ran).toEqual(['/pr merge', 'prompt: Fix PR #344: CI failed: check', '/pr close', '/pr'])
    await ui.unmount()
  })
}

test('a merged PR gets the release reminder, no PR buttons and a × that puts its band away; /pr hide takes the row down; without hermes-pr there is no row', async ($, on) => {
  fakeHost(on, { dirty: '', servers: [], stops: [] })
  let pr: unknown = { ...PR_344, state: 'merged', lines: PR_344.lines.map(l => ({ ...l, ok: true, detail: null })) }
  let hidden = false
  on('state.get', { plugin: 'hermes-pr', key: 'pr' }, () => ({ value: { value: pr, version: 1 } }))
  on('state.get', { plugin: 'hermes-pr', key: 'hidden' }, () => ({ value: { value: hidden, version: 1 } }))
  await $.command.run({ command: 'band', args: 'refresh', ...typed })
  const merged = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await merged.find({ text: /#344/ })).toBeDefined()
  expect(await merged.find({ text: /release with/ })).toBeDefined()
  expect(await merged.find({ key: 'merge' })).toBeUndefined()
  expect(await merged.find({ key: 'close-pr' })).toBeUndefined()
  await merged.press({ key: 'pr-dismiss' })
  expect(await merged.find({ key: 'pr-band' })).toBeUndefined()
  expect(await merged.find({ key: 'ship' })).toBeDefined()
  await merged.unmount()
  hidden = true
  const gone = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await gone.find({ text: /#344/ })).toBeUndefined()
  expect(await gone.find({ text: /t129-run-record/ })).toBeDefined()
  await gone.unmount()
  hidden = false
  pr = null
  const none = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
  expect(await none.find({ text: /#344|GitHub/ })).toBeUndefined()
  expect(await none.find({ key: 'ship' })).toBeDefined()
  await none.unmount()
})
