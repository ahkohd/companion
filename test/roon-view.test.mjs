import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import { FaceStore } from '../bridge/store.mjs'
import { DeviceLink } from '../bridge/device.mjs'
import { mergeSettings } from '../bridge/studio-settings.mjs'

const art = 'a'.repeat(40)

function fixture() {
  const store = new FaceStore()
  store.setSettings(
    mergeSettings(store.settings, {
      modules: { roon: { enabled: true } },
      device: { activeModule: 'roon' },
    }),
  )
  store.setSources({
    roon: {
      status: 'ready',
      artId: art,
      playing: true,
      track: 'A track',
      artist: 'Artist',
      zoneId: 'zone1',
    },
  })

  return store
}

test('Roon view is ephemeral and leaves playback, settings and animation timing unchanged', () => {
  const store = fixture(),
    settings = structuredClone(store.settings),
    revision = store.settingsRevision,
    epoch = store.animationEpoch,
    changedAt = store.changedAt

  assert.equal(store.frame().dashboard.expanded, false)

  store.setRoonExpanded(true)

  assert.equal(store.snapshot().display.dashboard.expanded, true)
  assert.equal(store.frame().dashboard.expanded, true)
  assert.equal(store.frame().dashboard.playing, true)
  assert.equal(store.animationEpoch, epoch)
  assert.equal(store.changedAt, changedAt)
  assert.deepEqual(store.settings, settings)
  assert.equal(store.settingsRevision, revision)

  const seq = store.seq
  store.setRoonExpanded(true)

  assert.equal(store.seq, seq)

  store.setRoonExpanded(false)

  assert.equal(store.frame().dashboard.expanded, false)

  const restarted = new FaceStore()
  restarted.setSettings(settings)

  assert.equal(restarted.roonExpanded, false)
})

test('Roon view validates requests and resets on module leave, disable, lost source or missing artwork', () => {
  const store = fixture()

  for (const value of [undefined, null, 0, 1, 'true', {}, []])
    assert.throws(() => store.setRoonExpanded(value), /on or off/)

  store.setRoonExpanded(true)
  store.setModule('face')

  assert.equal(store.roonExpanded, false)
  assert.throws(() => store.setRoonExpanded(true), /Show Roon/)

  store.setModule('roon')

  assert.equal(store.roonExpanded, false)

  store.setRoonExpanded(true)
  store.setSources({ roon: { status: 'auth-required' } })

  assert.equal(store.roonExpanded, false)
  assert.throws(() => store.setRoonExpanded(true))

  store.setSources({ roon: { status: 'ready', artId: art } })
  store.setRoonExpanded(true)
  store.setSources({ roon: { status: 'ready', artId: null, artworkLoading: false } })

  assert.equal(store.roonExpanded, false)

  store.setSources({ roon: { status: 'ready', artId: art } })
  store.setRoonExpanded(true)
  store.setSettings(mergeSettings(store.settings, { modules: { roon: { enabled: false } } }))

  assert.equal(store.roonExpanded, false)
  assert.throws(() => store.setRoonExpanded(true))
})

test('track changes retain expanded artwork and allow immediate collapse while a new cover loads', () => {
  const store = fixture()

  store.setRoonExpanded(true)
  store.setSources({ roon: { status: 'ready', artId: 'b'.repeat(40), track: 'Next track' } })

  assert.equal(store.roonExpanded, true)

  store.setSources({ roon: { status: 'ready', artId: null, artworkLoading: true } })

  assert.equal(store.roonExpanded, true)
  assert.throws(() => store.setRoonExpanded(true), /available artwork/)

  store.setRoonExpanded(false)

  assert.equal(store.roonExpanded, false)

  store.setSources({ roon: { status: 'ready', artId: 'c'.repeat(40) } })

  assert.equal(store.roonExpanded, false)
})

test('device Roon view events validate protocol and cannot invoke playback controls', async () => {
  const store = fixture()
  let controls = 0,
    views = 0
  const device = new DeviceLink(store, {
    onRoonControl: () => controls++,

    onRoonView: (expanded) => {
      views++
      store.setRoonExpanded(expanded)
    },
  })

  const send = (expanded, v = 1) =>
    device.receive(JSON.stringify({ type: 'roon-view', v, expanded }) + '\n')

  send(true)
  await turn()

  assert.equal(views, 0)

  device.ready = true

  for (const v of [0, 2, '1']) send(true, v)

  for (const value of [null, 1, 'true', {}, []]) send(value)

  await turn()

  assert.equal(views, 0)

  send(true)
  await turn()

  assert.equal(store.frame().dashboard.expanded, true)
  assert.equal(views, 1)

  send(false)
  await turn()

  assert.equal(store.roonExpanded, false)

  store.setModule('face')
  send(true)
  await turn()

  assert.equal(views, 2)
  assert.equal(controls, 0)
})
