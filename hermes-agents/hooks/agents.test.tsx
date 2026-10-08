import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { detailOf, elapsed, shortModel, summarize } from './register'

const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  component: 'Pane',
  requestId: 'hermes-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 140 } }

/** Stands for the engine: the Agent tool starts each spawn under the next id, tools answer, the list says what is running. */
const fakeEngine = (on: On, host: { ids: string[]; stopped: string[]; sent: { to: unknown; text: string }[] }, opened: string[] = []) => {
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: host.ids.shift() ?? 'a?' }))
  on('agent.list', () => ({ value: [] }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: {} as never }))
  on('tool.call', { tool: 'Grep' }, () => ({ result: {} as never }))
  on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
    host.stopped.push(e.task_id ?? '')
    return { result: { message: 'stopped', task_id: e.task_id ?? '', task_type: 'local_agent' } as never }
  })
  on('session.send', (_$, e) => {
    host.sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
}

const spawn = (description: string, extra: Record<string, unknown> = {}) =>
  ({
    tool_use_id: `tu-${description}`,
    prompt: `Do ${description}.`,
    description,
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
    ...extra,
  }) as never

const done = (agentId: string, answer: string) =>
  ({ reason: 'answer', answer, durationMs: 1000, isAborted: false, turnId: `t-${agentId}`, agentId }) as never

test('the helpers: model names, run times, tool details and the counts', async () => {
  expect(shortModel('claude-sonnet-5-5')).toBe('sonnet')
  expect(shortModel('opus')).toBe('opus')
  expect(shortModel('gpt-x')).toBe('gpt-x')
  expect(elapsed(12_400)).toBe('12s')
  expect(elapsed(184_000)).toBe('3m 04s')
  expect(elapsed(3_720_000)).toBe('1h 02m')
  expect(detailOf({ file_path: 'D:\\Projects\\HERMES\\docs\\systems\\catalog.md' })).toBe('catalog.md')
  expect(detailOf({ command: 'node checks/check.mjs', description: 'Run the health gate' })).toBe('Run the health gate')
  expect(detailOf({ pattern: 'agent\\.spawn' })).toBe('agent\\.spawn')
  const row = (status: 'running' | 'completed' | 'failed' | 'killed' | 'idle') => ({ status }) as never
  expect(summarize([row('running'), row('idle'), row('completed'), row('failed'), row('killed')])).toEqual({ total: 5, running: 2, done: 1, failed: 2 })
})

for (const surface of SURFACES) {
  test(`a spawned agent shows with its name, type, model and what it is doing (${surface})`, async ($, on) => {
    const host = { ids: ['a1', 'a2'], stopped: [], sent: [] }
    fakeEngine(on, host)
    await $.agent.spawn(spawn('scan catalog', { name: 'scout' }))
    await $.agent.spawn(spawn('read docs'))
    await $.tool.call({ tool: 'Read', file_path: 'D:/Projects/HERMES/docs/systems/catalog.md', agentId: 'a1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'agent.spawn', agentId: 'a2' } as never)
    await $.turn.complete(done('a2', 'Found three places.'))
    const ui = await $.ui.mount({ plugin: 'hermes-agents', surface, ...PANE })
    expect(await ui.find({ text: /^◈ agents $/ })).toBeDefined()
    expect(await ui.find({ text: /● 1 running/ })).toBeDefined()
    expect(await ui.find({ text: /✓ 1 done/ })).toBeDefined()
    expect(await ui.find({ text: /^scout$/ })).toBeDefined()
    expect(await ui.find({ text: /scan catalog/ })).toBeDefined()
    expect((await ui.findAll({ text: /^Explore$/ })).length).toBe(2)
    expect((await ui.findAll({ text: /^sonnet$/ })).length).toBe(2)
    expect(await ui.find({ text: /^ catalog\.md$/ })).toBeDefined()
    expect(await ui.find({ text: /^1 tools$/ })).toBeDefined()
    expect(await ui.find({ text: /^done$/ })).toBeDefined()
    await ui.unmount()
  })
}

test('the band summary counts running, done and failed agents', async ($, on) => {
  const host = { ids: ['a1', 'a2', 'a3'], stopped: [], sent: [] }
  fakeEngine(on, host)
  await $.agent.spawn(spawn('one'))
  await $.agent.spawn(spawn('two'))
  await $.agent.spawn(spawn('three'))
  await $.turn.complete(done('a1', 'ok'))
  await $.turn.complete({ reason: 'error', category: null, explanation: null, answer: '', durationMs: 5, isAborted: false, turnId: 't3', agentId: 'a3' } as never)
  const ui = await $.ui.mount({ plugin: 'hermes-agents', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^3$/ })).toBeDefined()
  expect(await ui.find({ text: /● 1 running/ })).toBeDefined()
  expect(await ui.find({ text: /✓ 1 done/ })).toBeDefined()
  expect(await ui.find({ text: /✗ 1 failed/ })).toBeDefined()
  await ui.unmount()
})

for (const surface of SURFACES) {
  test(`selecting an agent shows its steps and answer; stop asks first, then stops it (${surface})`, async ($, on) => {
    const host = { ids: ['a1'], stopped: [] as string[], sent: [] as { to: unknown; text: string }[] }
    fakeEngine(on, host)
    await $.agent.spawn(spawn('scan catalog', { name: 'scout' }))
    await $.tool.call({ tool: 'Read', file_path: 'docs/a.md', agentId: 'a1' } as never)
    await $.tool.call({ tool: 'Grep', pattern: 'needle', agentId: 'a1' } as never)
    const ui = await $.ui.mount({ plugin: 'hermes-agents', surface, ...PANE })
    expect(await ui.find({ text: /last steps/ })).toBeUndefined()
    await ui.press({ key: 'pick-a1' })
    expect(await ui.find({ text: /last steps/ })).toBeDefined()
    expect(await ui.find({ text: /task: Do scan catalog\./ })).toBeDefined()
    expect(await ui.find({ text: /^ needle$/ })).toBeDefined()
    await ui.input({ key: 'msg-a1', text: 'stop after this file' })
    expect(host.sent).toEqual([{ to: 'a1', text: 'stop after this file' }])
    await ui.press({ key: 'stop' })
    expect(host.stopped).toEqual([])
    await ui.press({ key: 'stop-no' })
    expect(await ui.find({ key: 'stop-yes' })).toBeUndefined()
    await ui.press({ key: 'stop' })
    await ui.press({ key: 'stop-yes' })
    expect(host.stopped).toEqual(['a1'])
    expect(await ui.find({ text: /^stopped$/ })).toBeDefined()
    expect(await ui.find({ key: 'stop' })).toBeUndefined()
    await ui.unmount()
  })
}

test('/agents-pane opens the pane, and /agents-pane clear drops the finished agents', async ($, on) => {
  const host = { ids: ['a1', 'a2'], stopped: [], sent: [] }
  const opened: string[] = []
  fakeEngine(on, host, opened)
  await $.agent.spawn(spawn('one'))
  await $.agent.spawn(spawn('two'))
  await $.turn.complete(done('a1', 'ok'))
  await $.command.run({ command: 'agents-pane', args: '', ...typed })
  expect(opened).toContain('hermes-agents')
  await $.command.run({ command: 'agents-pane', args: 'clear', ...typed })
  const ui = await $.ui.mount({ plugin: 'hermes-agents', surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /^1$/ })).toBeDefined()
  expect(await ui.find({ text: /✓ 0 done/ })).toBeDefined()
  expect(await ui.find({ text: /^one$/ })).toBeUndefined()
  expect(await ui.find({ text: /^two$/ })).toBeDefined()
  await ui.unmount()
})
