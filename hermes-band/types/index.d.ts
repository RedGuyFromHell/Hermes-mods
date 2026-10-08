/** The git facts the band shows for the session's tree. */
export type Repo = {
  /** The tree's root, forward slashes. */
  root: string
  branch: string
  /** The short HEAD hash. */
  head: string
  /** The worktree's folder name; null in the main tree. */
  tree: string | null
  /** Commits ahead of / behind the upstream; null when there is no upstream. */
  ahead: number | null
  behind: number | null
  /** Every modified, added, deleted or untracked path, relative to the root. */
  dirty: string[]
}

/** One running Hermes dev server, as the process scan found it. */
export type Server = {
  pid: number
  kind: 'api' | 'web'
  ports: number[]
  /** The worktree folder it runs from, forward slashes; null when the scan cannot tell. */
  tree: string | null
  /** True when the shell that started it has no living parent: its session is gone. */
  orphan: boolean
  /** The pids a stop must end: the server and its tsx watcher. */
  kill: number[]
}

/** One slice of the context window, as /context lists it. */
export type ContextSlice = {
  name: string
  tokens: number
  /** Share of the window, whole percent. */
  percent: number
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

/** One rate-limit window the last API answer reported: the 5-hour session limit, the 7-day weekly limit. */
export type Limit = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string
  /** 0 to 100, one decimal at most. */
  percent: number
  /** When the window resets, ms since the epoch; null when the API did not say. */
  resetsAt: number | null
}

/** The live context window: what the status line and /context know. */
export type Context = {
  used: number
  window: number
  /** The token count at which auto-compaction runs; null when it is off. */
  compactAt: number | null
  slices: ContextSlice[]
  limits: Limit[]
}

/** hermes-agents' counts, which the band reads (it never writes them): a copy of that mod's `AgentsSummary`. */
export type AgentsSummary = {
  total: number
  running: number
  done: number
  failed: number
}

declare module 'claude-code' {
  interface PluginState {
    /** Read only: hermes-agents owns and writes it. Absent when that mod is not loaded. */
    'hermes-agents': {
      summary: AgentsSummary
    }
    'hermes-band': {
      repo: Repo | null
      servers: Server[]
      context: Context | null
      /** Paths (relative to the root, lower case) this session edited through Edit, Write or NotebookEdit. */
      mine: string[]
      /** True after the first press of "stop orphans", until yes or no. */
      confirmStop: boolean
      hidden: boolean
      /** One short line under the band: the last action or the last error; null for none. */
      note: string | null
      /** When the servers were last scanned, ms since the epoch; 0 before the first scan. */
      scannedAt: number
    }
  }
}
