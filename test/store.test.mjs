import test from 'node:test'
import assert from 'node:assert/strict'
import { FaceStore, normalizeAgent, wireText } from '../bridge/store.mjs'

const agent = (id, state, extra = {}) => ({
  pane_id: id,
  agent: 'pi',
  name: id,
  agent_status: state,
  ...extra,
})

test('attention takes precedence and done means ready for review', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'working'), agent('b', 'blocked'), agent('c', 'done')])

  assert.equal(store.display().state, 'blocked')
  assert.equal(store.display().label, '1 needs attention')
  assert.equal(store.display().name, 'a')
  assert.equal(store.frame().name, 'a')
  assert.equal(store.frame().statusDots, false)
  assert.deepEqual(store.display().counts, { working: 1, blocked: 1, done: 1, idle: 0, unknown: 0 })

  store.select('c')

  assert.equal(store.display().label, 'Ready')
  assert.equal(store.display().name, 'c')
  assert.equal(store.frame().statusDots, false)

  store.select('a')

  assert.equal(store.frame().statusDots, false)
  assert.equal(store.frame().label, 'Working')

  store.select('all')

  assert.equal(store.frame().statusDots, false)
})

test('all agents uses the status and title rows with ready taking precedence over idle', () => {
  const store = new FaceStore()
  const cases = [
    [['working', 'done', 'idle', 'idle'], 'working', 'Working', '0'],
    [['working', 'idle', 'idle', 'idle'], 'working', 'Working', '0'],
    [['working', 'working'], 'working', '2 Working', '0'],
    [['done', 'done', 'idle'], 'done', 'Idle', '2 ready'],
    [['idle', 'idle'], 'idle', 'Idle', '2 idle'],
    [['blocked', 'working', 'done', 'idle'], 'blocked', '1 needs attention', '1'],
    [['unknown'], 'unknown', '1 unknown', '0 idle'],
    [[], 'idle', 'No agents running', ''],
  ]

  for (const [states, state, label, name] of cases) {
    store.ingest(states.map((s, i) => agent(String(i), s)))

    for (const display of [store.snapshot().display, store.frame()]) {
      assert.equal(display.state, state)
      assert.equal(display.label, label)
      assert.equal(display.name, name)
    }
  }
})

test('ready-to-idle count changes keep a working face running and clear on disconnect', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'working'), agent('b', 'done')])
  store.changedAt = Date.now() - 5000
  const { changedAt, animationEpoch } = store
  store.ingest([agent('a', 'working'), agent('b', 'idle')])

  assert.equal(store.frame().name, 'a')
  assert.equal(store.changedAt, changedAt)
  assert.equal(store.animationEpoch, animationEpoch)

  store.disconnect()

  assert.equal(store.frame().state, 'disconnected')
  assert.equal(store.frame().name, '')
})

test('selection cycles and resets when its agent disappears', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'idle'), agent('b', 'working')])
  store.cycle()

  assert.equal(store.selected, 'b')

  store.cycle()

  assert.equal(store.selected, 'a')

  store.cycle()

  assert.equal(store.selected, 'all')

  store.select('a')
  store.ingest([agent('b', 'working')])

  assert.equal(store.selected, 'all')
  assert.throws(() => store.select('missing'), /no longer/)
})

test('missing or disconnected agents cannot report success', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'brand-new-state')])

  assert.equal(store.display().state, 'unknown')

  store.select('a')
  store.disconnect()

  assert.equal(store.frame().state, 'disconnected')
  assert.equal(store.frame().name, '')

  store.ingest([])

  assert.equal(store.frame().label, 'No agents running')
})

test('the wire frame is bounded and excludes raw session data', () => {
  const store = new FaceStore()

  store.ingest([
    agent('a', 'working', {
      name: 'x'.repeat(1000),
      cwd: '/private/project',
      secret: 'not exported',
    }),
  ])
  store.select('a')

  assert.equal(store.frame().name.length, 48)
  assert.ok(Buffer.byteLength(JSON.stringify(store.frame()) + '\n') <= 1024)
  assert.equal(store.agents[0].project, 'project')
  assert.equal('secret' in store.agents[0], false)
  assert.equal(normalizeAgent({ pane_id: 'shell', agent: null }), null)

  const unicode = wireText('\u{1f680}'.repeat(40))

  assert.equal(Buffer.byteLength(unicode), 48)
  assert.equal(unicode.endsWith('\u{1f680}'), true)
})

test('device acknowledgements do not change the face revision', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'idle')])
  const { seq, changedAt } = store
  store.setDevice({ lastAck: Date.now() })

  assert.equal(store.seq, seq)
  assert.equal(store.changedAt, changedAt)
})

test('spacing reaches both displays without changing selection or animation age', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'working')])
  store.select('a')
  store.changedAt = Date.now() - 5000
  const { changedAt, animationEpoch } = store

  for (const gap of [4, 8, 16]) {
    store.setTextGap(gap)

    assert.equal(store.snapshot().layout.textGap, gap)
    assert.equal(store.frame().textGap, gap)
    assert.equal(store.selected, 'a')
    assert.equal(store.changedAt, changedAt)
    assert.equal(store.animationEpoch, animationEpoch)
  }

  const seq = store.seq
  store.setTextGap(16)

  assert.equal(store.seq, seq)
  assert.throws(() => store.setTextGap('4'), /text spacing/)
  assert.equal(store.textGap, 16)
})

test('wire clock and state age keep sleep aligned across updates and reconnection', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'idle')])
  store.select('a')
  store.changedAt = Date.now() - 40000
  store.ingest([agent('a', 'idle', { name: 'Updated title' })])
  store.setPointer({ enabled: true, status: 'active', x: 0.5, y: -0.5 })
  const frame = store.frame()

  assert.ok(frame.ageMs >= 40000 && frame.ageMs < 40100)
  assert.ok(Number.isFinite(frame.animationMs) && frame.animationMs >= 0)
  assert.equal(frame.state, 'idle')
  assert.equal(frame.preview, false)
  assert.ok(store.snapshot().animationMs >= frame.animationMs)
  assert.ok(Math.abs(store.snapshot().ageMs - frame.ageMs) < 100)

  store.setExpression('idle')

  assert.equal(store.frame().preview, true)
  assert.ok(store.frame().ageMs < 100)
})

test('playground overrides the wire state while Herdr keeps updating underneath', () => {
  const store = new FaceStore()

  store.ingest([agent('a', 'working')])
  store.select('a')

  for (const [expression, label] of [
    ['working', 'Working'],
    ['blocked', 'Needs your input'],
    ['done', 'Ready'],
    ['idle', 'Idle'],
    ['sleep', 'Sleeping'],
  ]) {
    store.setExpression(expression)

    assert.equal(store.snapshot().expression, expression)
    assert.equal(store.frame().state, expression)
    assert.equal(store.frame().label, label)
    assert.equal(store.snapshot().display.label, label)
    assert.equal(store.frame().preview, true)
    assert.equal(store.frame().name, 'Playground')
    assert.equal(store.frame().statusDots, false)
  }

  store.ingest([agent('a', 'done')])

  assert.equal(store.frame().state, 'sleep')
  assert.equal(store.agents[0].state, 'done')
  assert.equal(store.frame().counts.done, 1)

  store.setExpression(null)

  assert.equal(store.frame().state, 'done')
  assert.equal(store.frame().preview, false)
  assert.equal(store.selected, 'a')
})

test('playground works without Herdr and selection or touch clears it', () => {
  const store = new FaceStore()

  store.setExpression('idle')

  assert.equal(store.frame().state, 'idle')
  assert.equal(store.connected, false)

  store.disconnect()

  assert.equal(store.frame().state, 'idle')

  store.cycle()

  assert.equal(store.expression, null)
  assert.equal(store.frame().state, 'disconnected')

  store.setExpression('done')
  store.select('all')

  assert.equal(store.expression, null)

  for (const invalid of [undefined, 'missing', 'constructor', '__proto__', {}, 42]) {
    assert.throws(() => store.setExpression(invalid), /Unknown expression/)
  }

  assert.equal(store.expression, null)
})

test('animation epoch changes for explicit replays but stays fixed through heartbeats and gaze', () => {
  const store = new FaceStore()

  store.setExpression('done')
  const epoch = store.frame().epoch
  store.publish()
  store.setPointer({ x: 0.2, y: 0.5 })

  assert.equal(store.frame().epoch, epoch)

  store.setExpression('done')

  assert.equal(store.frame().epoch, (epoch + 1) >>> 0)

  store.setExpression('blocked')

  assert.equal(store.frame().epoch, (epoch + 2) >>> 0)

  store.setExpression(null)

  assert.equal(store.frame().epoch, (epoch + 3) >>> 0)
})
