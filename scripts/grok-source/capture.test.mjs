// Run: node --test scripts/grok-source/capture.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCapture, GROK_STATES, GROK_ACTIONS, ACTION_TRIGGER_SECONDS } from './capture.mjs'

const RE = 114.2705

function walk(node, fn) { fn(node); for (const c of node.children) walk(c, fn) }

function assertFinite(snap, label) {
  walk(snap, (n) => {
    for (const [k, v] of [...Object.entries(n.attributes), ...Object.entries(n.style)]) {
      assert.equal(typeof v, 'string', `${label}: <${n.tag}> ${k} is not a string`)
      assert.ok(!/NaN|Infinity|undefined|null/.test(v), `${label}: <${n.tag}> ${k}="${v}"`)
    }
  })
}

function bodyGroup(snap) {
  return snap.children.find((n) => n.tag === 'g' && n.children.some((c) => c.attributes['clip-path']))
}
const eyes = (snap) => bodyGroup(snap).children.find((c) => c.attributes['clip-path']).children
const backGroup = (snap) => snap.children[1]
const translateY = (transform) => Number(/translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform)[2])

function sample(name, opts, from, to, stepSeconds, fn) {
  const cap = createCapture(name, opts)
  for (let t = from; t <= to + 1e-9; t += stepSeconds) { cap.advance(t); fn(cap.snapshot(), t) }
}

test('catalogue matches the upstream tables', () => {
  assert.equal(GROK_STATES.length, 39)
  assert.equal(GROK_STATES[0], 'sleeping')
  assert.equal(GROK_STATES.at(-1), 'powering-down')
  assert.deepEqual([...GROK_ACTIONS], ['spin', 'double-spin', 'spin-bounce', 'spin-dizzy', 'spin-wild', 'bounce', 'burst', 'spin-burst'])
  assert.throws(() => createCapture('nope'), /unknown Grok state or action/)
})

test('snapshot shape is serialisable and keeps defs, clip path and CSS variables', () => {
  const cap = createCapture('idle')
  cap.advance(1)
  const snap = cap.snapshot()
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap)
  assert.equal(snap.tag, 'svg')
  assert.deepEqual(Object.keys(snap), ['tag', 'attributes', 'style', 'children'])
  assert.equal(snap.children[0].tag, 'defs')
  assert.equal(snap.children[0].children[0].tag, 'clipPath')
  assert.match(snap.children[0].children[0].children[0].attributes.d, /^M228\.541/)
  const body = bodyGroup(snap)
  assert.equal(body.children[0].style.fill, 'var(--fg)')
  assert.equal(eyes(snap)[0].style.fill, 'var(--bg)')
  assert.match(eyes(snap)[0].attributes.transform, /^translate\(/)
  assert.equal(snap.style.width, '340px')
  assert.ok(snap.attributes.viewBox)
})

test('every state renders finite geometry and moves over time', () => {
  for (const state of GROK_STATES) {
    const cap = createCapture(state, { seed: 11 })
    const frames = []
    for (const t of [0.5, 1.5, 3, 6]) {
      cap.advance(t)
      const snap = cap.snapshot()
      assertFinite(snap, `${state}@${t}`)
      frames.push(JSON.stringify(snap))
    }
    assert.ok(new Set(frames).size >= 2, `${state}: snapshots never change`)
  }
})

test('same seed is deterministic, different seeds diverge', () => {
  for (const state of ['idle', 'celebrate', 'working', 'humming']) {
    const a = createCapture(state, { seed: 3 }); a.advance(5)
    const b = createCapture(state, { seed: 3 }); b.advance(5)
    assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()), `${state}: not deterministic`)
  }
  // Idle keeps a zero gaze target, so use a state whose gaze is seeded.
  const a = createCapture('thinking', { seed: 3 }); a.advance(3)
  const b = createCapture('thinking', { seed: 4 }); b.advance(3)
  assert.notEqual(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()))
  assert.equal(Math.random.toString().includes('0x6d2b79f5'), false, 'host Math.random must stay untouched')
})

test('advance is frame exact and monotonic', () => {
  const cap = createCapture('idle')
  cap.advance(1)
  assert.equal(cap.frame(), 60)
  cap.advance(1.0166)
  assert.equal(cap.frame(), 60)
  cap.advance(1.01667)
  assert.equal(cap.frame(), 61)
  assert.throws(() => cap.advance(0.5), /before the current age/)
})

// Motion evidence collected on idle with the same seed, so any deviation
// can only come from the triggered action.
function evidence(name, opts) {
  const out = { eyesHidden: false, minBodyY: Infinity, maxBodyY: -Infinity, particles: 0, maxRotate: 0 }
  sample(name, opts, ACTION_TRIGGER_SECONDS, 3.2, 1 / 60, (snap) => {
    if (eyes(snap).some((e) => e.style.display === 'none')) out.eyesHidden = true
    const y = translateY(bodyGroup(snap).attributes.transform)
    out.minBodyY = Math.min(out.minBodyY, y)
    out.maxBodyY = Math.max(out.maxBodyY, y)
    out.particles = Math.max(out.particles, backGroup(snap).children.length)
    out.maxRotate = Math.max(out.maxRotate, Math.abs(Number(/rotate\(([-\d.]+)\)/.exec(bodyGroup(snap).attributes.transform)[1])))
  })
  return out
}

test('imperative actions trigger at 0.14 s and change the scene', () => {
  const opts = { seed: 21 }
  const base = evidence('idle', opts)
  assert.equal(base.eyesHidden, false)
  assert.equal(base.particles, 0)
  assert.ok(base.minBodyY > RE - 4, `idle body y ${base.minBodyY}`)
  for (const action of ['spin', 'double-spin', 'spin-bounce', 'spin-dizzy', 'spin-wild', 'spin-burst']) {
    assert.equal(evidence(action, opts).eyesHidden, true, `${action}: eyes never pass behind the body`)
  }
  assert.ok(evidence('bounce', opts).minBodyY < RE - 20, 'bounce: body never lifts')
  assert.ok(evidence('spin-bounce', opts).minBodyY < RE - 20, 'spin-bounce: body never lifts')
  assert.ok(evidence('spin-dizzy', opts).maxRotate > 5, 'spin-dizzy: body never wobbles')
  assert.ok(evidence('spin-wild', opts).maxRotate > 300, 'spin-wild: body never rolls')
  assert.ok(evidence('burst', opts).particles >= 20, 'burst: no particles')
  assert.ok(evidence('spin-burst', opts).particles >= 15, 'spin-burst: no particles')
  const wild = createCapture('spin-wild', opts)
  wild.advance(0.14)
  assert.equal(wild.age(), 0.14)
  wild.advance(0.2)
  assert.ok(Math.abs(Number(/rotate\(([-\d.]+)\)/.exec(bodyGroup(wild.snapshot()).attributes.transform)[1])) > 0, 'spin-wild rotation should start right after 0.14 s')
})

test('trigger() fires an action on a state capture at the current age', () => {
  const cap = createCapture('thinking', { seed: 5 })
  cap.advance(2)
  cap.trigger('burst')
  cap.advance(2.1)
  assert.ok(backGroup(cap.snapshot()).children.length >= 20)
})

test('reduced motion still renders finite geometry', () => {
  for (const name of ['idle', 'thinking', 'spin-wild']) {
    const cap = createCapture(name, { reduced: true })
    cap.advance(2)
    assertFinite(cap.snapshot(), `${name} reduced`)
  }
})
