import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentState, AgentsSummary, Step } from '../types'

const PANE = 'hermes-agents'
const TITLE = 'Agents'
const COMMAND = 'agents-pane'

/* ---------- state the pane and the band draw from ---------- */

const AGENTS = atom({ plugin: 'hermes-agents', key: 'agents' } as const, [])
const SUMMARY = atom({ plugin: 'hermes-agents', key: 'summary' } as const, { total: 0, running: 0, done: 0, failed: 0 })
const SELECTED = atom({ plugin: 'hermes-agents', key: 'selected' } as const, null)
const CONFIRM = atom({ plugin: 'hermes-agents', key: 'confirmStop' } as const, null)
const AUTO_OPENED = atom({ plugin: 'hermes-agents', key: 'autoOpened' } as const, false)
const NOTE = atom({ plugin: 'hermes-agents', key: 'note' } as const, null)
const NOW = atom({ plugin: 'hermes-agents', key: 'now' } as const, 0)

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
const PALETTE = ['#60a5fa', '#2dd4bf', '#a78bfa', '#4ade80', '#fbbf24', '#f472b6', '#fb923c', '#e879f9', '#38bdf8', '#a3e635']

/* ---------- pure helpers (exported for the tests) ---------- */

const ACTIVE: readonly AgentState[] = ['pending', 'running', 'waiting', 'idle']
export const isActive = (s: AgentState) => ACTIVE.includes(s)

export const summarize = (rows: readonly AgentRow[]): AgentsSummary => ({
  total: rows.length,
  running: rows.filter(r => isActive(r.status)).length,
  done: rows.filter(r => r.status === 'completed').length,
  failed: rows.filter(r => r.status === 'failed' || r.status === 'killed').length,
})

/** `claude-sonnet-5-5` -> `sonnet`; an alias stays as it is. */
export const shortModel = (model: string) => /opus|sonnet|haiku|fable/i.exec(model)?.[0]?.toLowerCase() ?? model

export const modelColor = (model: string) => {
  const m = shortModel(model)
  return m === 'opus' ? C.branch : m === 'sonnet' ? C.blue : m === 'haiku' ? '#2dd4bf' : m === 'fable' ? '#f472b6' : C.warn
}

/** One steady color per agent type, from the band's slice colors. */
export const typeColor = (type: string) => {
  let h = 0
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length] ?? C.blue
}

export const statusGlyph = (s: AgentState) =>
  s === 'running' ? '●' : s === 'waiting' ? '◐' : s === 'idle' ? '○' : s === 'pending' ? '◌' : s === 'completed' ? '✓' : s === 'failed' ? '✗' : '■'
export const statusColor = (s: AgentState) =>
  s === 'running' ? C.ok : s === 'waiting' ? C.warn : s === 'idle' ? C.tree : s === 'pending' ? C.warn : s === 'completed' ? C.blue : C.bad
export const statusWord = (s: AgentState) => (s === 'completed' ? 'done' : s === 'killed' ? 'stopped' : s)

/** "12s", "3m 04s", "1h 02m". */
export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const basename = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? p
const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** What a tool call is doing, in a verb. */
export const verb = (tool: string) => {
  if (tool === 'Read') return 'reading'
  if (tool === 'Edit' || tool === 'NotebookEdit') return 'editing'
  if (tool === 'Write') return 'writing'
  if (tool === 'Bash' || tool === 'PowerShell') return 'running'
  if (tool === 'Grep' || tool === 'Glob') return 'searching'
  if (tool === 'WebFetch' || tool === 'WebSearch' || tool.startsWith('mcp__Claude_Browser') || tool.startsWith('mcp__claude-in-chrome')) return 'browsing'
  if (tool === 'Agent') return 'spawning'
  if (tool === 'Skill') return 'loading skill'
  if (tool.startsWith('mcp__')) return tool.split('__').pop() ?? tool
  return tool.toLowerCase()
}

/** A few words for one tool call: the file, the pattern, the command's own description. */
export const detailOf = (input: Record<string, unknown>) => {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null)
  const file = str('file_path') ?? str('notebook_path')
  if (file !== null) return basename(file)
  const pick = str('description') ?? str('pattern') ?? str('query') ?? str('skill') ?? str('url') ?? str('command') ?? str('prompt') ?? ''
  return oneLine(pick, 60)
}

/* ---------- writes ---------- */

/** Changes the agent list, then the summary when its counts moved (so the band redraws only then). */
const saveAgents = async ($: EngineInterface, change: (rows: AgentRow[]) => AgentRow[]) => {
  const rows = await update($, AGENTS, change)
  const next = summarize(rows)
  const was = await read($, SUMMARY)
  if (was.total !== next.total || was.running !== next.running || was.done !== next.done || was.failed !== next.failed) await update($, SUMMARY, () => next)
}

const setNote = ($: EngineInterface, text: string | null) => update($, NOTE, () => text)

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** A row for an agent the pane did not see spawn (it began before this load, or a workflow started it). */
const placeholder = (id: string, now: number): AgentRow => ({
  id,
  name: null,
  description: 'agent',
  type: 'agent',
  model: '?',
  prompt: '',
  parentId: null,
  workflow: false,
  status: 'running',
  startedAt: now,
  endedAt: null,
  tools: 0,
  steps: [],
  answer: null,
})

/** Takes the engine's view of each running agent: its status and the name SendMessage knows it by. An ended row stays ended until its loop runs a tool again. */
const sync = async ($: EngineInterface) => {
  let list
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const byId = new Map(list.map(a => [a.id, a]))
  await saveAgents($, rows =>
    rows.map(r => {
      const a = byId.get(r.id)
      if (a === undefined || r.endedAt !== null) return r
      return { ...r, status: a.status, name: r.name ?? a.name ?? null, type: r.type === 'agent' ? a.type : r.type, description: r.description === 'agent' ? a.description : r.description }
    }),
  )
}

const tick = async ($: EngineInterface) => {
  const rows = await read($, AGENTS)
  if (!rows.some(r => isActive(r.status))) return
  await sync($)
  await update($, NOW, () => Date.now())
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

const stopAgent = async ($: EngineInterface, id: string) => {
  await update($, CONFIRM, () => null)
  try {
    const r = await $.tool.call({ tool: 'TaskStop', task_id: id })
    if (r.isError === true || r.deny !== undefined) {
      await setNote($, `stop refused: ${oneLine(r.deny ?? r.text ?? 'unknown reason', 120)}`)
      return
    }
    await saveAgents($, rows => rows.map(row => (row.id === id ? { ...row, status: 'killed', endedAt: Date.now() } : row)))
    await setNote($, `stopped ${id}`)
  } catch (err) {
    await setNote($, `stop failed: ${message(err)}`)
  }
}

const sendTo = async ($: EngineInterface, id: string, text: string) => {
  const t = text.trim()
  if (t === '') return
  try {
    await $.session.send({ to: { agentId: id }, text: t })
    await setNote($, `sent to ${id}: ${oneLine(t, 60)}`)
  } catch (err) {
    await setNote($, `message failed: ${message(err)}`)
  }
}

/* ---------- registration ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'hermes-agents: open the agents pane (every subagent, its model, status and what it is doing); "clear" drops the finished ones',
      argumentHint: 'clear',
    })
    /* Written at once, so the band shows "no agents yet" before the first agent. */
    await $.state.set({ plugin: 'hermes-agents', key: 'summary' } as const, summarize(await read($, AGENTS)))
    try {
      $.clock.every(3000, () => void tick($))
    } catch {}
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await saveAgents($, rows => rows.filter(r => isActive(r.status)))
      return { text: 'hermes-agents: finished agents cleared.' }
    }
    await openPane($)
    return { text: 'hermes-agents: pane opened.' }
  })

  /* A new agent: its row, and the pane the first time in a session. */
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId === undefined) return r
    const now = Date.now()
    const row: AgentRow = {
      id: r.agentId,
      name: e.name ?? null,
      description: e.description,
      type: e.subagentType,
      model: shortModel(r.model),
      prompt: e.prompt.slice(0, 600),
      parentId: e.parentAgentId ?? null,
      workflow: e.workflow !== undefined,
      status: 'running',
      startedAt: now,
      endedAt: null,
      tools: 0,
      steps: [],
      answer: null,
    }
    await saveAgents($, rows => [...rows.filter(x => x.id !== row.id), row])
    await update($, NOW, () => now)
    if (!(await read($, AUTO_OPENED))) {
      await update($, AUTO_OPENED, () => true)
      void openPane($)
    }
    return r
  })

  /* Every tool call inside an agent's loop: what it is doing now. */
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) return next(e)
    const step: Step = { at: Date.now(), tool: e.tool, detail: detailOf(e as unknown as Record<string, unknown>), state: 'running' }
    await saveAgents($, rows => {
      const known = rows.some(r => r.id === id)
      const all = known ? rows : [...rows, placeholder(id, step.at)]
      return all.map(r => (r.id === id ? { ...r, status: 'running', endedAt: null, tools: r.tools + 1, steps: [...r.steps, step].slice(-10) } : r))
    })
    const ran = await next(e)
    const state: Step['state'] = ran.deny !== undefined ? 'denied' : ran.isError === true ? 'error' : 'done'
    await saveAgents($, rows =>
      rows.map(r => (r.id === id ? { ...r, steps: r.steps.map(s => (s.at === step.at && s.tool === step.tool && s.detail === step.detail && s.state === 'running' ? { ...s, state } : s)) } : r)),
    )
    return ran
  })

  /* An agent's turn ended: its answer, and how it ended. */
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const status: AgentState = e.isAborted ? 'killed' : e.reason === 'answer' ? 'completed' : 'failed'
      const now = Date.now()
      await saveAgents($, rows =>
        rows.map(r => (r.id === id ? { ...r, status, endedAt: now, answer: e.answer === '' ? r.answer : e.answer.slice(0, 600), steps: r.steps.map(s => (s.state === 'running' ? { ...s, state: 'done' } : s)) } : r)),
      )
      await update($, NOW, () => now)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    /* Every surface but mobile has a text field. */
    const Input = 'Input' in els ? els.Input : null
    const rows = await read($, AGENTS)
    const summary = await read($, SUMMARY)
    const chosen = await read($, SELECTED)
    const confirm = await read($, CONFIRM)
    const note = await read($, NOTE)
    const tickNow = await read($, NOW)
    const now = Math.max(tickNow, Date.now())
    /* The agent in view in the transcript is the one shown, unless the person picked another. */
    const selectedId = chosen ?? e.props.view.agentId ?? null
    const selected = rows.find(r => r.id === selectedId) ?? null
    const dot = <Text dimColor> · </Text>

    const header = (
      <Box key="header" flexDirection="row" gap={1} alignItems="center">
        <Text>
          <Text color={C.warn} bold>
            ◈ agents{' '}
          </Text>
          <Text bold>{summary.total}</Text>
          {dot}
          <Text color={C.ok}>● {summary.running} running</Text>
          {dot}
          <Text color={C.blue}>✓ {summary.done} done</Text>
          {summary.failed > 0 ? (
            <Text>
              {dot}
              <Text color={C.bad} bold>
                ✗ {summary.failed} failed
              </Text>
            </Text>
          ) : null}
        </Text>
        {summary.done + summary.failed > 0 ? (
          <Button key="clear" dimColor hover={{ color: C.tree }} onPress={() => void saveAgents($, list => list.filter(r => isActive(r.status)))}>
            clear finished
          </Button>
        ) : null}
      </Box>
    )

    if (rows.length === 0) {
      return (
        <Box flexDirection="column" paddingX={1}>
          {header}
          <Text dimColor>No agents yet. When one starts, it shows here.</Text>
        </Box>
      )
    }

    const list = rows.map(r => {
      const last = r.steps[r.steps.length - 1]
      const live = isActive(r.status)
      const isSel = r.id === selectedId
      const sc = statusColor(r.status)
      return (
        <Box key={`row-${r.id}`} flexDirection="row" gap={1} backgroundColor={isSel ? C.card : undefined}>
          <Button key={`pick-${r.id}`} plain dimColor={!isSel} hover={{ color: C.tree }} onPress={() => void update($, SELECTED, cur => (cur === r.id ? null : r.id))}>
            {isSel ? '▾' : '›'}
          </Button>
          <Text wrap="truncate-end">
            <Text color={sc} bold>
              {statusGlyph(r.status)}{' '}
            </Text>
            <Text bold color={isSel ? C.tree : undefined}>
              {r.name ?? oneLine(r.description, 32)}
            </Text>
            {r.name !== null ? <Text dimColor> {oneLine(r.description, 28)}</Text> : null}
            {dot}
            <Text color={typeColor(r.type)}>{r.workflow ? `workflow ${r.type}` : r.type}</Text>
            {dot}
            <Text color={modelColor(r.model)}>{r.model}</Text>
            {dot}
            <Text color={live ? C.warn : undefined} dimColor={!live}>
              ⏱ {elapsed((r.endedAt ?? now) - r.startedAt)}
            </Text>
            {dot}
            <Text dimColor>{r.tools} tools</Text>
            {live && last !== undefined ? (
              <Text>
                {dot}
                <Text color={sc}>{verb(last.tool)}</Text>
                <Text> {last.detail}</Text>
              </Text>
            ) : !live ? (
              <Text>
                {dot}
                <Text color={sc}>{statusWord(r.status)}</Text>
              </Text>
            ) : null}
          </Text>
        </Box>
      )
    })

    let detail = null
    if (selected !== null) {
      const live = isActive(selected.status)
      const stopping = confirm === selected.id
      detail = (
        <Box key={`detail-${selected.id}`} flexDirection="column" marginTop={1} borderStyle="round" borderColor={statusColor(selected.status)} paddingX={1}>
          <Text wrap="truncate-end">
            <Text color={statusColor(selected.status)} bold>
              {statusGlyph(selected.status)} {selected.name ?? selected.description}
            </Text>
            {dot}
            <Text color={typeColor(selected.type)}>{selected.type}</Text>
            {dot}
            <Text color={modelColor(selected.model)}>{selected.model}</Text>
            {dot}
            <Text color={statusColor(selected.status)}>{statusWord(selected.status)}</Text>
            <Text dimColor>
              {' '}
              after {elapsed((selected.endedAt ?? now) - selected.startedAt)} · id {selected.id}
            </Text>
          </Text>
          {selected.prompt !== '' ? (
            <Text dimColor wrap="truncate-end">
              task: {oneLine(selected.prompt, 300)}
            </Text>
          ) : null}
          <Text color={C.warn} bold>
            last steps
          </Text>
          {selected.steps.length === 0 ? <Text dimColor> none yet</Text> : null}
          {selected.steps.map((s, i) => {
            const color = s.state === 'running' ? C.ok : s.state === 'done' ? C.blue : C.bad
            const glyph = s.state === 'running' ? '●' : s.state === 'done' ? '✓' : s.state === 'denied' ? '⊘' : '✗'
            return (
              <Text key={`step-${i}`} wrap="truncate-end">
                <Text color={color}> {glyph} </Text>
                <Text color={PALETTE[i % PALETTE.length]}>{s.tool.replace(/^mcp__[^_]+__/, '')}</Text>
                <Text dimColor> {s.detail}</Text>
              </Text>
            )
          })}
          {selected.answer !== null ? (
            <Text wrap="truncate-end">
              <Text color={C.ok} bold>
                answer{' '}
              </Text>
              <Text>{oneLine(selected.answer, 400)}</Text>
            </Text>
          ) : null}
          <Box flexDirection="row" gap={1} marginTop={1} alignItems="center">
            {Input !== null ? (
              <Input key={`msg-${selected.id}`} label="message" placeholder={live ? 'tell it something…' : 'a message resumes it…'} submitLabel="send" onSubmit={(value: string) => void sendTo($, selected.id, value)} />
            ) : null}
            {live ? (
              stopping ? (
                <Box key="stop-confirm" gap={1}>
                  <Text color={C.bad} bold>
                    stop it?
                  </Text>
                  <Button key="stop-yes" variant="primary" onPress={() => void stopAgent($, selected.id)}>
                    yes
                  </Button>
                  <Button key="stop-no" onPress={() => void update($, CONFIRM, () => null)}>
                    no
                  </Button>
                </Box>
              ) : (
                <Box key="stop-box">
                  <Button key="stop" hover={{ color: C.bad, bold: true }} onPress={() => void update($, CONFIRM, () => selected.id)}>
                    stop
                  </Button>
                </Box>
              )
            ) : null}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {header}
        {list}
        {detail}
        {note !== null ? (
          <Text dimColor wrap="truncate-end">
            {note}
          </Text>
        ) : null}
      </Box>
    )
  })
}
