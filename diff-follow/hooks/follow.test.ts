import { test, expect, mock, type Plugin } from 'claude-code/testing'
import { DEFAULTS, applyCommand, baseCandidates, isChanged, newSelection, relative } from './follow'

const ROOT = 'D:/Projects/HERMES'
const FILE = `${ROOT}/apps/api/src/index.ts`

const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

const run = (exitCode: number, stdout = '') => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('a click is a selection that changed to a file', () => {
  expect(newSelection(undefined, FILE)).toBe(FILE)
  expect(newSelection('', FILE)).toBe(FILE)
  expect(newSelection(FILE, FILE)).toBeNull()
  expect(newSelection(FILE, '')).toBeNull()
})

test('changed means git diff --quiet exited 1, or the file is untracked', () => {
  expect(isChanged(0, '')).toBe(false)
  expect(isChanged(1, '')).toBe(true)
  expect(isChanged(0, 'apps/api/src/new.ts\n')).toBe(true)
  expect(isChanged(128, '')).toBe(false)
})

test('the toast names the path under the root', () => {
  expect(relative(ROOT, FILE)).toBe('apps/api/src/index.ts')
  expect(relative(`${ROOT}/`, FILE)).toBe('apps/api/src/index.ts')
  expect(relative('D:/Other', FILE)).toBe(FILE)
})

test('the branch base is tried from origin HEAD, then the usual names, without repeats', () => {
  expect(baseCandidates('origin/main\n')).toEqual(['origin/main', 'main', 'master'])
  expect(baseCandidates('origin/trunk')).toEqual(['origin/trunk', 'origin/main', 'main', 'master'])
  expect(baseCandidates('')).toEqual(['origin/main', 'main', 'master'])
})

test('/difffollow reads on, off, scope and status', () => {
  expect(applyCommand('off', DEFAULTS).settings).toEqual({ enabled: false, scope: 'all' })
  expect(applyCommand('on', { enabled: false, scope: 'uncommitted' }).settings).toEqual({ enabled: true, scope: 'uncommitted' })
  expect(applyCommand('scope uncommitted', DEFAULTS).settings.scope).toBe('uncommitted')
  expect(applyCommand('scope all', { enabled: true, scope: 'uncommitted' }).settings.scope).toBe('all')
  expect(applyCommand('', DEFAULTS).text).toMatch(/is on/)
  expect(applyCommand('status', { enabled: false, scope: 'all' }).text).toMatch(/is off/)
  expect(applyCommand('scope sideways', DEFAULTS)).toEqual({ settings: DEFAULTS, text: expect.stringMatching(/^usage:/) })
  expect(applyCommand('banana', DEFAULTS).text).toMatch(/^usage:/)
})


/** A stand-in for filetree: `/click <path>` writes its `tree` value the way a row press does (the test's own `$` has no state). */
const FILETREE: Plugin = {
  name: 'filetree',
  register(on) {
    on('session.start', async ($, _e, next) => {
      await $.command.register({ name: 'click', description: 'select a file in the fake tree' })
      return next(_e)
    })
    on('command.run', { command: 'click' }, async ($, e) => {
      await $.state.set({ plugin: 'filetree', key: 'tree' } as const, { root: 'D:/Projects/HERMES', selected: e.args })
      return { text: e.args }
    })
  },
}

test('a changed file selected in filetree sends the diff pane to it; an unchanged one gets a toast', { plugins: [FILETREE] }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const shown: Record<string, unknown>[] = []
  const toasts: string[] = []
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] as const }))
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('mcp.call', (_$, e) => { shown.push({ server: e.server, tool: e.tool, ...e.args }); return { value: { content: [], isError: false } } })
  on('process.run', (_$, e) => {
    const argv = e.argv.join(' ')
    if (argv.includes('symbolic-ref')) return run(0, 'origin/main\n')
    if (argv.includes('merge-base')) return run(0, 'abc123\n')
    if (argv.includes('ls-files')) return run(0, '')
    if (argv.includes('diff --quiet')) return run(argv.endsWith('index.ts') ? 1 : 0)
    return run(0)
  })

  await $.command.run({ command: 'click', args: FILE, ...typed })
  await clock.advance(0)
  expect(shown).toEqual([{ server: 'ccd_view', tool: 'show_pane', pane: 'diff', path: FILE, diff_scope: 'all' }])
  expect(toasts).toEqual([])

  await $.command.run({ command: 'click', args: `${ROOT}/README.md`, ...typed })
  await clock.advance(0)
  expect(shown.length).toBe(1)
  expect(toasts).toEqual(['diff-follow: no changes in README.md'])

  await $.command.run({ command: 'click', args: `${ROOT}/README.md`, ...typed })
  await clock.advance(0)
  expect(toasts.length).toBe(1)
})

test('off means the pane is left alone; scope uncommitted compares against HEAD', { plugins: [FILETREE] }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const shown: Record<string, unknown>[] = []
  const gits: string[] = []
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('ui.toast', () => ({ value: undefined }))
  on('mcp.call', (_$, e) => { shown.push({ ...e.args }); return { value: { content: [], isError: false } } })
  on('process.run', (_$, e) => { gits.push(e.argv.join(' ')); return run(e.argv.includes('--quiet') ? 1 : 0, '') })

  expect((await $.command.run({ command: 'difffollow', args: 'off', ...typed })).text).toMatch(/is off/)
  await $.command.run({ command: 'click', args: FILE, ...typed })
  await clock.advance(0)
  expect(shown).toEqual([])

  expect((await $.command.run({ command: 'difffollow', args: 'on', ...typed })).text).toMatch(/is on/)
  expect((await $.command.run({ command: 'difffollow', args: 'scope uncommitted', ...typed })).text).toMatch(/uncommitted/)
  await $.command.run({ command: 'click', args: `${ROOT}/apps/web/src/App.tsx`, ...typed })
  await clock.advance(0)
  expect(shown).toEqual([{ pane: 'diff', path: `${ROOT}/apps/web/src/App.tsx`, diff_scope: 'uncommitted' }])
  expect(gits.some(g => g.includes('diff --quiet HEAD --'))).toBe(true)
  expect(gits.some(g => g.includes('merge-base'))).toBe(false)
})

test('in a terminal alone nothing is asked of the app', { plugins: [FILETREE] }, async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  let called = 0
  on('session.surfaces', () => ({ value: ['terminal'] as const }))
  on('mcp.call', () => { called++; return { value: { content: [], isError: false } } })
  on('process.run', () => { called++; return run(0) })
  await $.command.run({ command: 'click', args: FILE, ...typed })
  await clock.advance(0)
  expect(called).toBe(0)
})
