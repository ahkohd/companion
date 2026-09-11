import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'

let model, probe, directory
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'face-shimmer-'))
  probe = path.join(directory, 'probe')
  execFileSync('cc', [
    '-std=c11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-I',
    'firmware/main',
    'test/shimmer-probe.c',
    'firmware/main/face_shimmer.c',
    '-lm',
    '-o',
    probe,
  ])
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'web/shimmer.ts', formats: ['es'] } },
  })
  const bundle = Array.isArray(result) ? result[0] : result
  model = await import(
    'data:text/javascript;base64,' +
      Buffer.from(bundle.output.find((c) => c.type === 'chunk' && c.isEntry).code).toString(
        'base64',
      )
  )
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('native and browser shimmer colours share timing across sweeps, rests and long uptime', () => {
  const commands = [],
    expected = []

  for (const time of [...Array.from({ length: 281 }, (_, i) => i * 0.02), 86400.35, 1e8 + 0.8, -1])
    for (const u of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])
      for (const reduced of [false, true]) {
        commands.push(`${time} ${u} ${+reduced}`)
        expected.push(model.shimmerColor(time, u, reduced))
      }

  const values = execFileSync(probe, [], { input: commands.join('\n') + '\n', encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(Number)

  assert.equal(values.length, expected.length)

  values.forEach((color, i) =>
    assert.deepEqual([color >>> 16, (color >>> 8) & 255, color & 255], expected[i]),
  )
})

test('highlight travels left to right and rests as readable static text', () => {
  assert.ok(model.shimmerCenter(0.35) < model.shimmerCenter(1.1))

  for (const time of [1.6, 2, 2.79, NaN, Infinity, -1])
    assert.equal(model.shimmerCenter(time), null)

  const base = model.shimmerColor(2, 0.5)

  assert.deepEqual(base, [156, 149, 173])
  assert.deepEqual(model.shimmerColor(0.8, 0.5), [245, 239, 255])

  for (const time of [0, 0.35, 0.8, 1.1, 80000])
    assert.deepEqual(model.shimmerColor(time, 0.5, true), base)

  assert.equal(model.shimmerGradient(0.35, true), model.shimmerGradient(1.1, true))
})

test('mask blit preserves glyph shape, antialiasing and output bounds', () => {
  assert.match(
    execFileSync(probe, ['raster'], { encoding: 'utf8' }),
    /shimmer raster checks passed/,
  )
})

test('native and browser subtitle shimmer share their muted palette and timing', () => {
  const commands = [],
    expected = []

  for (const time of [0, 0.35, 0.8, 1.1, 1.6, 2.79, 2.8, 86400.35, -1])
    for (const u of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])
      for (const reduced of [false, true]) {
        commands.push(`${time} ${u} ${+reduced}`)
        expected.push(model.subtitleShimmerColor(time, u, reduced))
      }

  const values = execFileSync(probe, ['subtitle'], {
    input: commands.join('\n') + '\n',
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .map(Number)

  assert.equal(values.length, expected.length)

  values.forEach((color, i) =>
    assert.deepEqual([color >>> 16, (color >>> 8) & 255, color & 255], expected[i]),
  )

  assert.deepEqual(model.subtitleShimmerColor(2, 0.5), [126, 118, 140])
  assert.deepEqual(model.subtitleShimmerColor(0.8, 0.5), [182, 174, 197])
})
