import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('native Roon motion settings support instant defaults, optional transitions and independent playback rotation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'roon-motion-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'probe')
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main',
    'test/roon-motion-probe.c', 'firmware/main/roon_motion.c', '-lm', '-o', executable])
  assert.match(execFileSync(executable, [], { encoding: 'utf8' }), /1000 interruption cases/)
})
