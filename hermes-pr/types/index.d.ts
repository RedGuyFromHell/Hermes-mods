/** The CI verdict over every check of the PR's head commit. */
export type CiState = 'pass' | 'fail' | 'pending' | 'none'

/** GitHub's own answer on merging into the base. */
export type Mergeable = 'clean' | 'conflicts' | 'unknown'

/** `reviewDecision`, folded: `none` is "no review required", the repo's case today. */
export type Review = 'approved' | 'changes' | 'required' | 'none'

export type PrState = 'open' | 'draft' | 'merged' | 'closed'

/** What `release/pr-conflicts.mjs` said: `main` is a conflict with the base, `conflicts` one with another open PR. */
export type Siblings = {
  state: 'clean' | 'conflicts' | 'main' | 'unknown'
  /** The conflicting pairs or files, one line; empty when clean. */
  detail: string
}

/** One status chip of the PR: `ok` null while unknown. hermes-band draws these. */
export type Line = {
  ok: boolean | null
  text: string
  /** A second, dimmer line: the CI reason, the conflicting pairs. */
  detail: string | null
}

/** The pull request of the session's branch, as hermes-pr read it and hermes-band draws it. */
export type PrView = {
  number: number
  url: string
  title: string
  state: PrState
  base: string
  head: string
  ci: {
    state: CiState
    /** The names of the checks that did not pass. */
    failing: string[]
    /** Why, when a job never started or failed with an annotation; null when there is none. */
    reason: string | null
    /** The first failing check's page, from which the job id is read. */
    detailsUrl: string | null
  }
  mergeable: Mergeable
  review: Review
  /** Commits on origin/<base> the branch does not have; null when git could not say. */
  behind: number | null
  /** Null where the repo has no conflict script, or the PR is no longer open. */
  siblings: Siblings | null
  /** The five chips, in the band's order: CI, main, behind, the other PRs, review. */
  lines: Line[]
}

export type Action = 'merge' | 'close'

declare module 'claude-code' {
  interface PluginState {
    'hermes-pr': {
      /** The branch's PR; null when the branch has none or is main/prod. hermes-band reads it. */
      pr: PrView | null
      /** The prompt that fixes what is red, ready to submit; null while nothing is red. hermes-band's fix PR button submits it. */
      fix: string | null
      /** The branch the session stands on; null before the first refresh. */
      branch: string | null
      /** The action running now, so a button is not pressed twice. */
      busy: Action | null
      /** The last action's result, one line. */
      note: string | null
      /** When the PR was last read, ms since the epoch; 0 before the first read. */
      refreshedAt: number
      /** `/pr hide` took the PR row down; `/pr show` or `/pr` brings it back. */
      hidden: boolean
    }
  }
}
