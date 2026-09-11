import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises'
import { FaceStore } from '../bridge/store.mjs'
import { PointerTracker } from '../bridge/pointer.mjs'

function setup(t, options = {}) {
  const store = new FaceStore(),
    children = []
  const pointer = new PointerTracker(store, {
    platform: 'darwin',

    prepare: async () => '/helper',

    launch: (executable, args) => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.args = args
      child.kill = () => {
        child.killed = true
      }
      children.push(child)

      return child
    },

    ...options,
  })
  t.after(() => pointer.stop())

  return { store, pointer, children }
}

const enabled = (intervalMs = 100) => ({ enabled: true, intervalMs })

test('pointer stays off by default and rejects unsupported configuration', async (t) => {
  const { store, pointer, children } = setup(t)

  assert.equal(store.pointer.enabled, false)
  assert.equal(store.frame().look, null)

  for (const config of [
    null,
    {},
    { enabled: 'yes', intervalMs: 100 },
    enabled(0),
    enabled(150),
    enabled('100'),
  ]) {
    assert.throws(() => pointer.configure(config))
  }

  pointer.configure({ enabled: false, intervalMs: 250 })
  await turn()

  assert.equal(children.length, 0)
  assert.equal(store.pointer.intervalMs, 250)

  const unsupported = setup(t, { platform: 'linux' })

  assert.throws(() => unsupported.pointer.configure(enabled()), /macOS/)
  assert.equal(unsupported.store.pointer.supported, false)
})

test('fragmented samples update the shared gaze without changing expression, sleep age or selection', async (t) => {
  const { store, pointer, children } = setup(t)

  store.ingest([{ pane_id: 'a', agent: 'pi', agent_status: 'working' }])
  store.select('a')
  store.setExpression('sleep')
  const changedAt = store.changedAt
  pointer.configure(enabled())
  await turn()
  const child = children[0]

  assert.deepEqual(child.args, ['100'])

  child.stdout.write('null\ninvalid\n{"x":-0.8,')

  assert.equal(store.pointer.status, 'starting')

  child.stdout.write('"y":0.35}\n')

  assert.deepEqual(store.frame().look, { x: -0.8, y: 0.35 })
  assert.equal(store.frame().state, 'sleep')
  assert.equal(store.frame().preview, true)
  assert.equal(store.changedAt, changedAt)
  assert.equal(store.selected, 'a')

  const seq = store.seq
  child.stdout.write('{"x":-0.8,"y":0.35}\n{"x":2,"y":0}\n{"x":"0","y":0}\n')

  assert.equal(store.seq, seq)

  pointer.configure({ enabled: false, intervalMs: 100 })

  assert.equal(child.killed, true)
  assert.equal(store.frame().look, null)

  child.stdout.write('{"x":1,"y":1}\n')
  child.emit('close', 0)

  assert.equal(store.pointer.status, 'off')
  assert.equal(store.changedAt, changedAt)
})

test('interval changes replace the sampler and ignore old process output', async (t) => {
  const { store, pointer, children } = setup(t)

  pointer.configure(enabled())
  await turn()
  const first = children[0]
  pointer.configure(enabled(1000))
  await turn()

  assert.equal(first.killed, true)
  assert.deepEqual(children[1].args, ['1000'])

  first.emit('error', new Error('Old failure'))
  first.stdout.write('{"x":1,"y":1}\n')

  assert.equal(store.pointer.status, 'starting')

  children[1].stdout.write('{"x":0,"y":-1}\n')

  assert.deepEqual(store.frame().look, { x: 0, y: -1 })

  pointer.configure(enabled(1000))
  await turn()

  assert.equal(children.length, 2)
})

test('disabling while the helper builds prevents a late sampler from starting', async (t) => {
  let resolveBuild
  const { store, pointer, children } = setup(t, {
    prepare: () =>
      new Promise((resolve) => {
        resolveBuild = resolve
      }),
  })

  pointer.configure(enabled())
  pointer.configure({ enabled: false, intervalMs: 100 })
  resolveBuild('/helper')
  await turn()

  assert.equal(children.length, 0)
  assert.equal(store.pointer.status, 'off')
})

test('failed or stalled helpers clear gaze and allow a retry', async (t) => {
  const { store, pointer, children } = setup(t, { staleMs: 20 })

  pointer.configure(enabled())
  await turn()
  children[0].stdout.write('{"x":1,"y":1}\n')
  await delay(65)

  assert.equal(store.pointer.status, 'error')
  assert.equal(store.frame().look, null)
  assert.equal(children[0].killed, true)

  pointer.configure(enabled())
  await turn()
  children[1].stdout.write('{"x":-1,"y":-1}\n')

  assert.equal(store.pointer.status, 'active')

  children[1].emit('close', 1)

  assert.equal(store.pointer.status, 'error')
  assert.equal(store.frame().look, null)

  pointer.configure(enabled())
  await turn()
  children[2].stdout.write('x'.repeat(4097))

  assert.equal(store.pointer.status, 'error')
  assert.equal(children[2].killed, true)
})
