import type { DiffFollowScope, DiffFollowSettings } from '../types'

export const DEFAULTS: DiffFollowSettings = { enabled: true, scope: 'all' }

/** The file a click just selected: the new `selected` when it changed to a non-empty path, else null. */
export function newSelection(previous: string | undefined, selected: string): string | null {
  if (!selected || selected === previous) return null
  return selected
}

/** `git diff --quiet` answers 1 when the file differs from the base; an untracked file is new, so it counts too. */
export function isChanged(diffExitCode: number, untrackedListing: string): boolean {
  return diffExitCode === 1 || untrackedListing.trim().length > 0
}

/** The path as the tree shows it: under the root without the root, else as given. */
export function relative(root: string, path: string): string {
  const base = root.endsWith('/') ? root : `${root}/`
  return path.startsWith(base) ? path.slice(base.length) : path
}

/** The candidates for the branch base, in order: origin's default branch (when git names one), then the usual names. */
export function baseCandidates(originHead: string): string[] {
  const named = originHead.trim()
  return [...(named ? [named] : []), 'origin/main', 'main', 'master'].filter((c, i, all) => all.indexOf(c) === i)
}

export function describe(settings: DiffFollowSettings): string {
  const scope = settings.scope === 'all' ? 'all branch changes' : 'uncommitted changes'
  return settings.enabled ? `diff-follow is on: the diff pane follows the filetree selection (${scope})` : 'diff-follow is off'
}

/** Reads `/difffollow <args>`: on, off, scope all|uncommitted, or a status ask; anything else is the usage line. */
export function applyCommand(args: string, current: DiffFollowSettings): { settings: DiffFollowSettings; text: string } {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [verb, arg] = words
  if (!verb || verb === 'status') return { settings: current, text: describe(current) }
  if (verb === 'on' || verb === 'off') {
    const settings = { ...current, enabled: verb === 'on' }
    return { settings, text: describe(settings) }
  }
  if (verb === 'scope' && (arg === 'all' || arg === 'uncommitted')) {
    const settings = { ...current, scope: arg as DiffFollowScope }
    return { settings, text: describe(settings) }
  }
  return { settings: current, text: 'usage: /difffollow on | off | scope all | scope uncommitted | status' }
}
