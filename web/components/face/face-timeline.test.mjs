import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'

let FaceTimeline
before(async () => {
  const result = await build({
    configFile: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'web/components/face/face-timeline.ts', formats: ['es'] } },
  })
  const bundle = Array.isArray(result) ? result[0] : result
  const entry = bundle.output.find(item => item.type === 'chunk' && item.isEntry)
  ;({ FaceTimeline } = await import(`data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`))
})

const input = overrides => ({
  state: 'idle', animationMs: 100_000, ageMs: 4000, changedAt: 196_000, ...overrides,
})
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`)

test('host time advances across a hidden tab while retaining the original eyes', () => {
  const timeline = new FaceTimeline(input({ state: 'done', ageMs: 0 }), false, 500, 200_000)
  assert.deepEqual(timeline.tick(1700, 201_200).eyes, timeline.engine.sample(101.2))
  const resumed = timeline.tick(61_700, 261_200)
  near(resumed.time, 161.2)
  near(resumed.age, 61.2)
  assert.deepEqual(resumed.eyes, timeline.engine.sample(resumed.time))
})

test('a restarted host preserves the current gaze and expression transition', () => {
  const start = input()
  const timeline = new FaceTimeline(start, false, 1000, 200_000)
  const changed = { ...start, state: 'done', animationMs: 100_100, ageMs: 0, look: { x: 1, y: -1 } }
  timeline.update(changed, false, 1100, 200_100)
  const before = timeline.tick(1200, 200_200)
  const profile = timeline.engine.profile(before.time)
  const after = timeline.update({ ...changed, animationMs: 200, ageMs: 100 }, false, 1200, 200_200)
  near(after.time, .2)
  near(after.age, .1)
  for (const key of ['x', 'y', 'mix']) near(after.gaze[key], before.gaze[key])
  const rebased = timeline.engine.profile(after.time)
  near(rebased.split, profile.split)
  for (const key of ['yaw', 'pitch', 'roll']) near(rebased.gaze[key], profile.gaze[key])
  rebased.eyes.forEach((eye, index) => {
    for (const key of ['w', 'h', 'open', 'tilt']) near(eye[key], profile.eyes[index][key])
  })
})

test('stale host snapshots cannot move the local clock backwards', () => {
  const start = input()
  const timeline = new FaceTimeline(start, false, 1000, 200_000)
  timeline.tick(1050, 200_050)
  const next = timeline.update({ ...start, animationMs: 100_020, ageMs: 4020 }, false, 1050, 200_050)
  near(next.time, 100.05)
  near(next.age, 4.05)
})

test('idle sleeps at 30 seconds while an idle preview stays awake', () => {
  const start = input({ changedAt: 200_000, ageMs: 0 })
  const live = new FaceTimeline(start, false, 1000, 200_000)
  assert.equal(live.tick(30_999, 229_999).mode, 'idle')
  assert.equal(live.tick(31_000, 230_000).mode, 'sleep')
  const preview = new FaceTimeline({ ...start, preview: true }, false, 1000, 200_000)
  assert.equal(preview.tick(61_000, 260_000).mode, 'idle')
})

test('enabling reduced motion settles an ongoing gaze', () => {
  const start = input({ state: 'working' })
  const timeline = new FaceTimeline(start, false, 1000, 200_000)
  const following = { ...start, look: { x: 1, y: -1 } }
  timeline.update(following, false, 1100, 200_100)
  const moving = timeline.tick(1200, 200_200)
  assert.ok(moving.gaze.x > .2 && moving.gaze.x < .35)
  const still = timeline.update(following, true, 1200, 200_200)
  assert.deepEqual(still.gaze, { x: 1, y: -1, mix: 1 })
  assert.deepEqual(still.eyes, timeline.engine.sample(still.time, true))
  near(timeline.tick(10_000, 209_000).time, still.time)
  const resumed = timeline.update(following, false, 10_000, 209_000)
  near(resumed.time, 109)
})

test('replaying an expression resets its age and preserves the pointer glide', () => {
  const start = input({ state: 'done', look: { x: .8, y: -.4 } })
  const timeline = new FaceTimeline(start, false, 1000, 200_000)
  const before = timeline.tick(1200, 200_200)
  const replay = timeline.update({ ...start, animationMs: 100_200, ageMs: 0, changedAt: 200_200 }, false, 1200, 200_200)
  assert.equal(replay.age, 0)
  assert.deepEqual(replay.gaze, before.gaze)
  assert.deepEqual(replay.eyes, timeline.engine.sample(replay.time))
})

test('unknown states and invalid initial timestamps still render finite eyes', () => {
  const timeline = new FaceTimeline(input({ state: 'not-a-state', animationMs: NaN, ageMs: NaN }), false, 1000, 200_000)
  const frame = timeline.sample()
  assert.equal(frame.mode, 'unknown')
  assert.equal(frame.age, 0)
  assert.equal(frame.eyes.length, 2)
  assert.ok(frame.eyes.every(eye => eye.matrix.every(Number.isFinite)))
})

test('changing face size leaves age, gaze and expression timing unchanged', () => {
  for (const reduced of [false, true]) {
    const props = input({ state: 'working', look: { x: .4, y: -.2 }, faceScale: 100 })
    const timeline = new FaceTimeline(props, reduced, 500, 200_000)
    const before = timeline.sample()
    for (const faceScale of [50, 150, 100]) {
      const after = timeline.update({ ...props, faceScale }, reduced, 500, 200_000)
      near(after.age, before.age); near(after.time, before.time)
      assert.deepEqual(after.gaze, before.gaze); assert.equal(after.mode, before.mode)
    }
  }
})
