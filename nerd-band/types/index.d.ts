/** One nested repo inside the knowledge base (the theme, the workbench, the Etsy server), each committed on its own. */
export type Nested = {
  /** The short label the band shows: theme, workbench, etsy. */
  name: string
  branch: string
  /** Commits ahead of / behind the upstream; null when there is no upstream. */
  ahead: number | null
  behind: number | null
  /** How many paths are modified, added, deleted or untracked. */
  dirty: number
}

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
  /** The nested repos found under the root; empty in a worktree, where they are not checked out. */
  nested: Nested[]
}

/** One running Nerd Castle dev server, as the process scan found it. */
export type Server = {
  pid: number
  /** `theme`: shopify theme dev. `video`: hyperframes preview. */
  kind: 'theme' | 'video'
  ports: number[]
  /** The folder it runs from, forward slashes; null when the scan cannot tell. */
  tree: string | null
  /** True when the shell that started it has no living parent: its session is gone. */
  orphan: boolean
  /** The pids a stop must end: the server and the node launchers above it. */
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

declare module 'claude-code' {
  interface PluginState {
    'nerd-band': {
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
      /** When the repos were last fetched from GitHub, ms since the epoch; 0 before the first fetch. */
      fetchedAt: number
    }
  }
}
