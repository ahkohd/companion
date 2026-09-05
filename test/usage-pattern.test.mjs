import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('native pixel progress bars preserve geometry, transparency and exact progress with bounded buffers', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'usage-pattern-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'probe')
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main',
    'test/usage-pattern-probe.c', 'firmware/main/usage_pattern.c', '-o', executable])
  assert.match(execFileSync(executable, [], { encoding: 'utf8' }), /PASS: 31252 patterned bar cases/)
})
