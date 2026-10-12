import type { Register, EngineInterface } from 'claude-code'
import type { DiffFollowSettings } from '../types'
import { DEFAULTS, applyCommand, baseCandidates, isChanged, newSelection, relative } from './follow'

/** filetree's tree: read here, written by that mod alone. A hook on its write sees each new selection. */
const TREE = { plugin: 'filetree', key: 'tree' } as const
const STORE_KEY = 'settings'
const COMMAND = 'difffollow'
/** The desktop app's view server, as its tools are named (`mcp__ccd_view__show_pane`). */
const VIEW_SERVER = 'ccd_view'

type $ = EngineInterface

/** Clicks are counted so a slow git check for an earlier click never moves the pane after a later one. */
let clicks = 0

async function settings($: $): Promise<DiffFollowSettings> {
  const stored = (await $.store.get(STORE_KEY)) as Partial<DiffFollowSettings> | undefined
  return { ...DEFAULTS, ...(stored ?? {}) }
}

function git($: $, root: string, args: string[]) {
  return $.process.run(['git', '--no-optional-locks', '-C', root, ...args], { timeoutMs: 5_000, env: { GIT_OPTIONAL_LOCKS: '0' } })
}

/** What the file is compared against: HEAD for uncommitted changes, the merge base with the default branch for the whole branch. */
async function baseOf($: $, root: string, scope: DiffFollowSettings['scope']): Promise<string> {
  if (scope === 'uncommitted') return 'HEAD'
  const originHead = await git($, root, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'])
  for (const candidate of baseCandidates(originHead.exitCode === 0 ? originHead.stdout : '')) {
    const base = await git($, root, ['merge-base', 'HEAD', candidate])
    if (base.exitCode === 0 && base.stdout.trim()) return base.stdout.trim()
  }
  return 'HEAD'
}

function errorText(content: readonly { type: string; text?: string }[]): string {
  return content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join(' ').trim() || 'the diff pane refused'
}

/** Points the app's diff pane at `path` when the file has changes in the chosen scope; says so in a toast when it has none. */
async function follow($: $, root: string, path: string, click: number): Promise<void> {
  const current = await settings($)
  if (!current.enabled) return
  const surfaces = await $.session.surfaces()
  if (!surfaces.includes('desktop')) return
  const base = await baseOf($, root, current.scope)
  const diff = await git($, root, ['diff', '--quiet', base, '--', path])
  const untracked = await git($, root, ['ls-files', '--others', '--exclude-standard', '--', path])
  if (click !== clicks) return
  if (!isChanged(diff.exitCode, untracked.stdout)) {
    $.ui.toast(`diff-follow: no changes in ${relative(root, path)}`)
    return
  }
  const shown = await $.mcp.call(VIEW_SERVER, 'show_pane', { pane: 'diff', path, diff_scope: current.scope })
  if (shown.isError) $.ui.toast(`diff-follow: ${errorText(shown.content)}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'The diff pane follows the filetree selection: on, off, scope all | uncommitted, status', argumentHint: 'on | off | scope all | scope uncommitted | status' })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const { settings: next, text } = applyCommand(e.args, await settings($))
    await $.store.set(STORE_KEY, next)
    return { text }
  })

  on('state.set', TREE, async ($, e, next) => {
    const result = await next(e)
    const previous = e.previous as { selected?: string } | undefined
    const path = newSelection(previous?.selected, e.value.selected)
    if (path) {
      const click = ++clicks
      const root = e.value.root
      $.clock.after(0, () => void follow($, root, path, click).catch(error => $.ui.toast(`diff-follow: ${error instanceof Error ? error.message : String(error)}`)))
    }
    return result
  })
}
