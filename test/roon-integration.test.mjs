import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FaceStore } from '../bridge/store.mjs'
import { defaultSettings, mergeSettings, StudioSettings } from '../bridge/studio-settings.mjs'

test('four-module saved settings gain disabled Roon without resetting existing designs', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'companion-roon-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const saved = defaultSettings()
  delete saved.modules.roon
  delete saved.design.roon
  saved.device.moduleOrder = ['hey', 'clock', 'face', 'usage']
  saved.design.usage.numberSize = 63
  const filePath = path.join(dir, 'settings.json')
  await writeFile(filePath, JSON.stringify(saved))
  const store = new FaceStore(),
    settings = new StudioSettings(store, { filePath })

  await settings.load()

  assert.deepEqual(store.settings.device.moduleOrder, [
    ...saved.device.moduleOrder,
    'roon',
    'audio',
    'speedDial',
  ])
  assert.equal(store.settings.modules.roon.enabled, false)
  assert.equal(store.settings.design.usage.numberSize, 63)

  const restored = structuredClone(store.settings)
  delete restored.modules.roon
  delete restored.design.roon
  restored.device.moduleOrder = restored.device.moduleOrder.filter(
    (id) => !['roon', 'audio', 'speedDial'].includes(id),
  )

  assert.deepEqual(restored, saved)
})

test('Roon metadata stays bounded and survives updates from the other sources', () => {
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
      zoneId: 'zone-a',
      track: '"'.repeat(200),
      artist: 'Artist'.repeat(50),
      artId: 'a'.repeat(40),
      playing: true,
      canNext: true,
      canPrevious: false,
      privateToken: 'secret',
    },
  })
  store.setSources({ usage: { status: 'disabled' }, hey: { status: 'disabled' } })
  const frame = store.frame()

  assert.equal(frame.dashboard.artId, 'a'.repeat(40))
  assert.equal(frame.dashboard.playing, true)
  assert.equal(frame.dashboard.canPrevious, false)
  assert.ok(Buffer.byteLength(frame.dashboard.track) <= 64)
  assert.ok(Buffer.byteLength(frame.dashboard.artist) <= 64)
  assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 2048)
  assert.doesNotMatch(JSON.stringify(frame), /privateToken|secret/)

  store.setSources({ roon: { status: 'auth-required' } })

  assert.equal(store.frame().dashboard.status, 'auth')
  assert.equal(store.frame().dashboard.artId, '')
  assert.equal(store.frame().dashboard.canNext, false)
})

test('Roon configuration rejects URLs, control characters and unknown fields', () => {
  for (const patch of [
    { host: 'http://192.168.1.5' },
    { host: '127.0.0.1/path' },
    { zoneId: 'bad\nzone' },
    { enabled: 'true' },
    { password: 'secret' },
  ])
    assert.throws(() => mergeSettings(defaultSettings(), { modules: { roon: patch } }))

  assert.equal(
    mergeSettings(defaultSettings(), {
      modules: { roon: { host: 'roon.local', zoneId: 'zone-a' } },
    }).modules.roon.host,
    'roon.local',
  )
})
