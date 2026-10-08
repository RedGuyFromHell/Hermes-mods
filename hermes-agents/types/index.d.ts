/** Where an agent's loop stands, as `$.agent.list()` says it. */
export type AgentState = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'

/** One tool call an agent made. */
export type Step = {
  /** When it started, ms since the epoch. */
  at: number
  tool: string
  /** A few words: the file, the pattern, the command's description. */
  detail: string
  state: 'running' | 'done' | 'error' | 'denied'
}

/** One agent of the session, as the pane shows it. */
export type AgentRow = {
  /** The id `$.agent.list()` and every event of its loop carry. */
  id: string
  /** What SendMessage addresses it by; null when the call gave none. */
  name: string | null
  /** The Agent call's short description of the task. */
  description: string
  /** `general-purpose`, `Explore`, `Plan`, a plugin's agent... */
  type: string
  /** What it runs on, short: `sonnet`, `opus`, or the id as given. */
  model: string
  /** The task it was given, first 600 characters. */
  prompt: string
  /** The agent that spawned it; null when the main conversation did. */
  parentId: string | null
  /** True when a Workflow script started it. */
  workflow: boolean
  status: AgentState
  startedAt: number
  /** When its last turn ended; null while it runs. */
  endedAt: number | null
  /** How many tool calls it made. */
  tools: number
  /** Its last 10 tool calls, oldest first. */
  steps: Step[]
  /** Its final answer, first 600 characters; null before it has one. */
  answer: string | null
}

/** The counts the band shows next to the limit gauges. */
export type AgentsSummary = {
  total: number
  /** Pending, running, waiting or idle. */
  running: number
  done: number
  /** Failed or stopped. */
  failed: number
}

declare module 'claude-code' {
  interface PluginState {
    'hermes-agents': {
      /** Every agent this session started, oldest first. */
      agents: AgentRow[]
      summary: AgentsSummary
      /** The agent whose detail the pane shows; null for none. */
      selected: string | null
      /** The agent whose stop waits for "yes"; null for none. */
      confirmStop: string | null
      /** True once the pane opened by itself, so it does that once a session. */
      autoOpened: boolean
      /** One short line under the list: the last action or error. */
      note: string | null
      /** The clock the run times are drawn against, moved every few seconds while an agent runs. */
      now: number
    }
  }
}
