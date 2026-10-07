import { test, expect } from 'claude-code/testing'

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('/band with no argument answers a one-line summary of the tree and the servers', async ($, on) => {
  on('session.cwd', () => ({ value: 'D:/Projects/HERMES' }))
  on('process.run', (_$, e) => {
    const a = e.argv.join(' ')
    if (a.startsWith('git rev-parse --show-toplevel')) return ok('D:/Projects/HERMES\n')
    if (a.startsWith('git rev-parse --abbrev-ref')) return ok('t129-run-record\n')
    if (a.startsWith('git rev-parse --short')) return ok('abc1234\n')
    if (a.startsWith('git rev-parse --git-common-dir')) return ok('D:/Projects/HERMES/.git\n')
    if (a.startsWith('git status')) return ok(' M apps/api/src/index.ts\n?? docs/new.md\n')
    if (a.startsWith('git rev-list')) return ok('0\t0\n')
    if (a.includes('ConvertTo-Json')) return ok(JSON.stringify([{ pid: 11, kind: 'api', ports: [3062], tree: 'D:/Projects/hermes-x', orphan: true, kill: [11, 10] }]))
    return ok('')
  })
  const r = await $.command.run({ command: 'band', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(r.text).toBe('t129-run-record @ abc1234 on HERMES (2 dirty)\napi :3062 D:/Projects/hermes-x ORPHAN')
})
