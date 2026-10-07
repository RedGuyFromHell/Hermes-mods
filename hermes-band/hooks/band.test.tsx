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
  await $.command.run({ command: 'band', args: 'forget', ...typed })
  expect(await ui.find({ text: /1 not mine/ })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'band', args: 'hide', ...typed })
  let passedOn = false
  try {
    const hidden = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND })
    await hidden.unmount()
  } catch (err) {
    passedOn = /no implementation for ui.render/.test(String(err))
  }
  expect(passedOn).toBe(true)
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
  let passedOn = false
  try {
    const ui = await $.ui.mount({ plugin: 'hermes-band', surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
    await ui.unmount()
  } catch (err) {
    passedOn = /no implementation for ui.render/.test(String(err))
  }
  expect(passedOn).toBe(true)
})
