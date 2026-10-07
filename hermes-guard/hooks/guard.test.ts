import { test, expect, mock } from 'claude-code/testing'

const bashOk = { result: { stdout: '', stderr: '', interrupted: false } }

test('git add -A and git add . are refused; a path is allowed', async ($, on) => {
  let reached = ''
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    reached = e.command
    return bashOk
  })
  expect((await $.tool.call({ tool: 'Bash', command: 'git add -A' })).deny).toMatch(/stage by explicit path/)
  expect((await $.tool.call({ tool: 'Bash', command: 'git add .' })).deny).toMatch(/stage by explicit path/)
  expect((await $.tool.call({ tool: 'Bash', command: 'git add --all' })).deny).toMatch(/stage by explicit path/)
  const byPath = await $.tool.call({ tool: 'Bash', command: 'git add apps/api/src/index.ts' })
  expect(byPath.deny).toBeUndefined()
  expect(reached).toBe('git add apps/api/src/index.ts')
})

test('git commit -a is refused', async $ => {
  expect((await $.tool.call({ tool: 'Bash', command: 'git commit -am "x"' })).deny).toMatch(/commit -a/)
  expect((await $.tool.call({ tool: 'PowerShell', command: 'git commit --all -m "x"' })).deny).toMatch(/commit -a/)
})

test('a test file cannot gain .skip or .only, and cannot be removed', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
  const skip = await $.tool.call({
    tool: 'Edit',
    file_path: 'D:/Projects/HERMES/apps/api/src/modules/stock/tests/math.test.ts',
    old_string: 'it("adds"',
    new_string: 'it.skip("adds"',
  })
  expect(skip.deny).toMatch(/skip/)
  const plain = await $.tool.call({
    tool: 'Edit',
    file_path: 'D:/Projects/HERMES/apps/api/src/modules/stock/tests/math.test.ts',
    old_string: 'it("adds"',
    new_string: 'it("adds two"',
  })
  expect(plain.deny).toBeUndefined()
  const rm = await $.tool.call({ tool: 'Bash', command: 'rm apps/api/src/modules/stock/tests/math.test.ts' })
  expect(rm.deny).toMatch(/removes a test file/)
})

test('an em-dash cannot enter app source, but a doc may hold one', async ($, on) => {
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
  const src = await $.tool.call({
    tool: 'Edit',
    file_path: 'D:/Projects/HERMES/apps/web/src/catalog/Products.tsx',
    old_string: 'a',
    new_string: 'stock \u2014 price',
  })
  expect(src.deny).toMatch(/dash/)
  const doc = await $.tool.call({
    tool: 'Edit',
    file_path: 'D:/Projects/HERMES/docs/systems/catalog.md',
    old_string: 'a',
    new_string: 'stock \u2014 price',
  })
  expect(doc.deny).toBeUndefined()
})

test('a hands-off path is refused until /guard unlock', async ($, on) => {
  mock.store(on)
  on('session.id', () => ({ value: 'test-session' }))
  on('session.cwd', () => ({ value: 'D:/Projects/HERMES' }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
  on('tool.call', { tool: 'Bash' }, () => bashOk)
  const edit = {
    tool: 'Edit' as const,
    file_path: 'D:\\Projects\\HERMES\\apps\\api\\src\\modules\\stock\\sync\\emagSync.ts',
    old_string: 'a',
    new_string: 'b',
  }
  expect((await $.tool.call(edit)).deny).toMatch(/hands-off/)
  const sed = await $.tool.call({ tool: 'Bash', command: 'sed -i "s/a/b/" apps/api/src/systems/billing-ledger/billing.ts' })
  expect(sed.deny).toMatch(/hands-off/)
  const read = await $.tool.call({ tool: 'Bash', command: 'sed -n 1,40p apps/api/src/systems/billing-ledger/billing.ts' })
  expect(read.deny).toBeUndefined()
  const typed = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
  await $.command.run({ command: 'guard', args: 'unlock', ...typed })
  expect((await $.tool.call(edit)).deny).toBeUndefined()
  await $.command.run({ command: 'guard', args: 'lock', ...typed })
  expect((await $.tool.call(edit)).deny).toMatch(/hands-off/)
})

test('an Agent call without a model gets sonnet; Plan gets opus; fork and an explicit model are left alone', async ($, on) => {
  const seen: Array<string | undefined> = []
  on('tool.call', { tool: 'Agent' }, (_$, e) => {
    seen.push(e.model)
    return { result: {} as never }
  })
  await $.tool.call({ tool: 'Agent', description: 'look', prompt: 'find x' })
  await $.tool.call({ tool: 'Agent', description: 'plan', prompt: 'plan x', subagent_type: 'Plan' })
  await $.tool.call({ tool: 'Agent', description: 'fork', prompt: 'go', subagent_type: 'fork' })
  await $.tool.call({ tool: 'Agent', description: 'hard', prompt: 'review', model: 'opus' })
  expect(seen).toEqual(['sonnet', 'opus', undefined, 'opus'])
})
