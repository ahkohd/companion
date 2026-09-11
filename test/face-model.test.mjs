import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'

let model, probe, directory
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'face-model-'))
  probe = path.join(directory, 'probe')
  execFileSync('cc', [
    '-std=c11',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-I',
    'firmware/main',
    'test/face-model-probe.c',
    'firmware/main/face_model.c',
    '-lm',
    '-o',
    probe,
  ])
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: 'test/face-reference.ts', formats: ['es'] },
    },
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

function compare(actual, expected) {
  assert.equal(actual.length, 2)

  actual.forEach((eye, i) => {
    for (const key of ['w', 'h', 'alpha'])
      assert.ok(
        Math.abs(eye[key] - expected[i][key]) < 0.001,
        `${key}: ${eye[key]} vs ${expected[i][key]}`,
      )

    eye.matrix.forEach((value, j) =>
      assert.ok(
        Math.abs(value - expected[i].matrix[j]) < 0.011,
        `matrix ${j}: ${value} vs ${expected[i].matrix[j]}`,
      ),
    )
  })
}

test('all native expressions match browser geometry through blinks and mouse gaze', () => {
  const expected = [],
    commands = []

  for (const [i, state] of model.FACE_STATES.entries())
    for (const time of [0, 1.45, 2, 9.12, 50, 899, 900.5, 901.45, 1801.45])
      for (const look of [
        { x: 0, y: 0, mix: 0 },
        { x: -1, y: -1, mix: 1 },
        { x: 1, y: 1, mix: 1 },
        { x: 0.25, y: -0.75, mix: 0.5 },
      ]) {
        commands.push(`P ${i} ${time} ${look.x} ${look.y} ${look.mix}`)
        expected.push(model.renderEyes(model.FACE_PROFILES[state], time, look))
      }

  const actual = execFileSync(probe, [], { input: commands.join('\n') + '\n', encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(JSON.parse)

  assert.equal(actual.length, expected.length)

  actual.forEach((eyes, i) => compare(eyes, expected[i]))
})

test('shared faces preserve the original Bloub expressions and continue blinking after 15 minutes', () => {
  for (const state of model.FACE_STATES)
    for (const time of [0, 1.45, 2, 9.12, 901.45])
      for (const look of [
        { x: 0, y: 0, mix: 0 },
        { x: -1, y: -1, mix: 1 },
        { x: 1, y: 1, mix: 1 },
      ]) {
        const original = model.reference(state)
        original.setLook(
          { yaw: look.x * 25, pitch: -look.y * 20, mix: look.mix, spin: 0, wander: 1 - look.mix },
          0,
          0,
        )
        const expected = original.sample(time).eyes,
          actual = model.renderEyes(model.FACE_PROFILES[state], time, look)

        assert.equal(expected.length, 2)

        actual.forEach((eye, i) => {
          assert.equal(eye.d, expected[i].d)

          const matrix = expected[i].matrix.slice(7, -1).split(',').map(Number)
          eye.matrix.forEach((value, j) =>
            assert.ok(
              Math.abs(value - matrix[j]) < 0.011,
              `${state} matrix ${j}: ${value} vs ${matrix[j]}`,
            ),
          )
        })
      }

  const profile = model.FACE_PROFILES.idle,
    look = { x: 0, y: 0, mix: 0 }
  const blink = model.renderEyes(profile, 901.45, look)[0],
    awake = model.renderEyes(profile, 902, look)[0]

  assert.ok(Math.abs(blink.matrix[3]) < Math.abs(awake.matrix[3]) * 0.7)
})

test('interrupted expressions and pointer transitions agree across browser and native model', () => {
  const motion = new model.FaceMotion('idle', 0),
    expected = [],
    commands = ['I 3 0']

  const state = (name, t) => {
    motion.setState(name, t)
    commands.push(`S ${model.FACE_STATES.indexOf(name)} ${t}`)
  }

  const look = (value, t) => {
    motion.setLook(value, t)
    commands.push(`L ${value ? 1 : 0} ${value?.x ?? 0} ${value?.y ?? 0} ${t}`)
  }

  const sample = (t) => {
    expected.push(motion.sample(t))
    commands.push(`R ${t}`)
  }

  state('done', 1)
  sample(1)
  sample(1.05)
  look({ x: 1, y: -1 }, 1.1)
  sample(1.15)
  state('blocked', 1.2)
  sample(1.2)
  sample(1.3)
  look({ x: -1, y: 1 }, 1.35)
  sample(1.4)
  state('working', 1.45)
  sample(1.5)
  look(null, 1.6)
  sample(1.7)
  sample(2.5)
  state('sleep', 3)
  sample(3.2)
  sample(4)
  state('idle', 4.5)
  sample(5)
  const actual = execFileSync(probe, [], { input: commands.join('\n') + '\n', encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(JSON.parse)
  actual.forEach((eyes, i) => compare(eyes, expected[i]))
})

test('native ready raster contains an open eye and a wider closed eye', () => {
  const image = execFileSync(probe, ['2', '2'])
  const header = Buffer.from('P6\n466 466\n255\n')

  assert.ok(image.subarray(0, header.length).equals(header))

  const pixels = image.subarray(header.length),
    boxes = []
  const seen = new Uint8Array(466 * 466)

  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !pixels[start * 3 + 1]) continue

    const queue = [start]
    seen[start] = 1
    let minX = 466,
      maxX = 0,
      minY = 466,
      maxY = 0

    for (let j = 0; j < queue.length; j++) {
      const p = queue[j],
        x = p % 466,
        y = Math.floor(p / 466)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)

      for (const next of [
        x ? p - 1 : -1,
        x < 465 ? p + 1 : -1,
        y ? p - 466 : -1,
        y < 465 ? p + 466 : -1,
      ])
        if (next >= 0 && !seen[next] && pixels[next * 3 + 1]) {
          seen[next] = 1
          queue.push(next)
        }
    }

    if (queue.length > 10) boxes.push({ x: minX, width: maxX - minX + 1, height: maxY - minY + 1 })
  }

  boxes.sort((a, b) => a.x - b.x)

  assert.equal(boxes.length, 2)
  assert.ok(boxes[0].height > boxes[1].height * 2, JSON.stringify(boxes))
  assert.ok(boxes[1].width > boxes[0].width * 1.2, JSON.stringify(boxes))
})

test('reduced motion keeps eyes finite and open when changing expressions or gaze', () => {
  const motion = new model.FaceMotion('idle', 1.45)

  for (const state of model.FACE_STATES) {
    motion.setState(state, 1.45, true)
    motion.setLook({ x: 0.25, y: -0.5 }, 1.45, true)
    const eyes = motion.sample(1.45, true)

    assert.ok(eyes.every((e) => e.matrix.every(Number.isFinite)))

    const expected = model.renderEyes(model.FACE_PROFILES[state], 0, motion.look(1.45))
    compare(eyes, expected)
  }
})

test('a restarted bridge can reset the browser clock without losing a transition', () => {
  const motion = new model.FaceMotion('idle', 100)

  motion.setState('done', 101)
  motion.setLook({ x: 1, y: -1 }, 101.1)
  const before = motion.profile(101.2),
    look = motion.look(101.2)
  motion.rebaseClock(101.2, 0.2)

  assert.equal(motion.state, 'done')

  const expected = model.renderEyes(before, 0.2, look)
  compare(motion.sample(0.2), expected)
})

test('mouse gaze glides visibly and preserves velocity when targets change every 100 ms', () => {
  const motion = new model.FaceMotion('idle', 0),
    expected = [],
    commands = ['I 3 0']

  const target = (x, y, t) => {
    motion.setLook({ x, y }, t)
    commands.push(`L 1 ${x} ${y} ${t}`)
  }

  const sample = (t) => {
    expected.push(motion.sample(t))
    commands.push(`R ${t}`)
  }

  target(1, 0, 1)

  assert.ok(
    motion.look(1.1).x > 0.2 && motion.look(1.1).x < 0.35,
    'First 100 ms must not snap most of the way',
  )

  for (let i = 1; i <= 20; i++) {
    const t = 1 + i * 0.1,
      epsilon = 0.00001
    const before = motion.look(t),
      velocity = (before.x - motion.look(t - epsilon).x) / epsilon
    target(i % 2 ? -1 : 1, i % 3 ? -0.8 : 0.8, t)

    assert.ok(Math.abs(motion.look(t).x - before.x) < 1e-10, 'Target updates must not jump')

    const afterVelocity = (motion.look(t + epsilon).x - motion.look(t).x) / epsilon

    assert.ok(Math.abs(afterVelocity - velocity) < 0.003, 'Target updates must retain velocity')

    sample(t)
    sample(t + 0.033)
    sample(t + 0.066)
  }

  sample(3.3)
  sample(3.8)
  sample(4.6)

  assert.deepEqual(motion.look(4.6), motion.lookTarget)

  const actual = execFileSync(probe, [], { input: commands.join('\n') + '\n', encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(JSON.parse)
  actual.forEach((eyes, i) => compare(eyes, expected[i]))
})

test('reduced motion snaps an ongoing gaze glide even when its target is unchanged', () => {
  const motion = new model.FaceMotion('idle', 0)

  motion.setLook({ x: 1, y: -1 }, 1)
  motion.setLook({ x: 1, y: -1 }, 1.1, true)

  assert.deepEqual(motion.look(1.1), { x: 1, y: -1, mix: 1 })
  assert.deepEqual(motion.look(1.3), { x: 1, y: -1, mix: 1 })
})
