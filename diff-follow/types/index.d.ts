/** What diff-follow keeps across sessions under `$.store`: on or off, and which changes the diff pane shows. */
export type DiffFollowScope = 'all' | 'uncommitted'

export type DiffFollowSettings = {
  enabled: boolean
  scope: DiffFollowScope
}

/** The part of filetree's `tree` value this mod reads (a copy, as hermes-band copies savvy-progress's; filetree alone writes it). */
export type FiletreeTree = {
  root: string
  selected: string
}

declare module 'claude-code' {
  interface PluginState {
    filetree: {
      tree: FiletreeTree
    }
  }
}
