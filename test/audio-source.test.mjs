import test from 'node:test'
import assert from 'node:assert/strict'
import { AudioSource } from '../bridge/audio-source.mjs'
import { FaceStore } from '../bridge/store.mjs'
import { defaultSettings, mergeSettings } from '../bridge/studio-settings.mjs'

const data = () => ({
  output: {
    deviceId: 10,
    deviceName: 'DAC',
    devices: [
      { id: 10, name: 'DAC' },
      { id: 11, name: 'Speakers' },
    ],
    volume: null,
    muted: null,
    canVolume: false,
    canMute: false,
  },
  input: {
    deviceId: 20,
    deviceName: 'Mic',
    devices: [{ id: 20, name: 'Mic' }],
    volume: 28,
    muted: false,
    canVolume: true,
    canMute: true,
  },
})

function fixture(t) {
  let current = data()
  const calls = []
  const source = new AudioSource({
    platform: 'darwin',
    intervalMs: 100000,

    runner: async (cmd, args) => {
      calls.push(args)

      if (args[0] === 'volume') current[args[1]].volume = Number(args[3])

      if (args[0] === 'mute') current[args[1]].muted = args[3] === 'true'

      if (args[0] === 'device') {
        current[args[1]].deviceId = Number(args[2])
        current[args[1]].deviceName = 'Speakers'
      }

      return { code: 0, stdout: JSON.stringify(current) }
    },
  })
  source.enabled = true
  source.started = true
  t.after(() => source.stop())

  return { source, calls, current }
}

test('Audio detects capabilities and cycles input/output independently', async (t) => {
  const { source } = fixture(t)

  await source.poll()

  assert.equal(source.snapshot().volume, null)
  assert.equal(source.snapshot().canMute, false)
  assert.equal(source.snapshot().nextDeviceId, 11)

  source.page({ direction: 1 })

  assert.equal(source.snapshot().scope, 'input')
  assert.equal(source.snapshot().volume, 28)
  assert.equal(source.snapshot().nextDeviceId, 0)

  source.page({ direction: -1 })

  assert.equal(source.snapshot().scope, 'output')
})

test('Audio rejects unsupported controls, stale devices/pages and invalid volumes', async (t) => {
  const { source, calls, current } = fixture(t)

  await source.poll()

  await assert.rejects(
    source.control({ scope: 'output', deviceId: 10, action: 'volume', value: 50 }),
    /managed/,
  )
  assert.ok(calls.every((c) => c[0] === 'get'))

  source.page({ scope: 'input' })

  await assert.rejects(
    source.control({ scope: 'output', deviceId: 10, action: 'mute', value: true }),
    /Choose/,
  )

  for (const value of [-1, 101, NaN, 1.5])
    await assert.rejects(
      source.control({ scope: 'input', deviceId: 20, action: 'volume', value }),
      /valid/,
    )

  current.input.deviceId = 21

  await assert.rejects(
    source.control({ scope: 'input', deviceId: 20, action: 'mute', value: true }),
    /changed/,
  )
})

test('Audio applies exact bounded volume, mute and device selections', async (t) => {
  const { source } = fixture(t)

  await source.poll()
  source.page({ scope: 'input' })
  await source.control({ scope: 'input', deviceId: 20, action: 'volume', value: 35 })

  assert.equal(source.snapshot().volume, 35)

  await source.control({ scope: 'input', deviceId: 20, action: 'mute', value: true })

  assert.equal(source.snapshot().muted, true)

  source.page({ scope: 'output' })
  await source.control({ scope: 'output', deviceId: 10, action: 'device', value: 11 })

  assert.equal(source.snapshot().deviceId, 11)
})

test('disabled audio rejects writes and ignores late helper reads', async () => {
  let resolve
  const source = new AudioSource({
    runner: () => new Promise((r) => (resolve = r)),

    platform: 'darwin',
  })
  source.enabled = true
  source.started = true
  const pending = source.poll()

  source.configure({ enabled: false })
  resolve({ code: 0, stdout: JSON.stringify(data()) })
  await pending

  assert.equal(source.snapshot().status, 'disabled')
  await assert.rejects(
    source.control({ scope: 'output', deviceId: 10, action: 'mute', value: true }),
    /Enable/,
  )
})

test('Audio wire frame preserves unknown values and fits serial budget', () => {
  const settings = mergeSettings(defaultSettings(), {
    modules: { audio: { enabled: true } },
    device: { activeModule: 'audio' },
  })
  const store = new FaceStore()

  store.setSettings(settings, 1)
  store.setSources({
    audio: {
      status: 'ready',
      scope: 'output',
      deviceId: 10,
      nextDeviceId: 11,
      deviceCount: 2,
      deviceName: 'DAC',
      volume: null,
      muted: null,
      canVolume: false,
      canMute: false,
    },
  })

  assert.equal(store.display().dashboard.volume, null)
  assert.equal(store.display().dashboard.nextDeviceId, 11)
  assert.ok(Buffer.byteLength(JSON.stringify(store.frame()) + '\n') <= 2048)
})

test('device selection passes expected current device to the native guard', async (t) => {
  const { source, calls } = fixture(t)

  await source.poll()
  await source.control({ scope: 'output', deviceId: 10, action: 'device', value: 11 })

  assert.deepEqual(calls.at(-1), ['device', 'output', '11', '10'])
})

test('long Audio errors remain valid bounded firmware text', () => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(defaultSettings(), {
      modules: { audio: { enabled: true } },
      device: { activeModule: 'audio' },
    }),
    1,
  )
  store.setSources({ audio: { status: 'error', scope: 'input', error: 'Unavailable '.repeat(30) } })

  assert.ok(Buffer.byteLength(store.frame().dashboard.detail) <= 48)
})

test('picker puts the active device first on page one and selecting active returns without a native write', async (t) => {
  const { source, current, calls } = fixture(t)
  current.output.devices = Array.from({ length: 7 }, (_, i) => ({
    id: 10 + i,
    name: 'Device ' + i,
  }))
  current.output.deviceId = 14

  await source.poll()
  source.view({ open: true, scope: 'output', deviceId: 14 })

  assert.equal(source.snapshot().pageIndex, 0)
  assert.equal(source.snapshot().pageCount, 3)
  assert.deepEqual(
    source.snapshot().devices.map((d) => d.id),
    [14, 10, 11],
  )
  assert.equal(source.snapshot().devices[0].active, true)

  source.page({ direction: 1 })

  assert.deepEqual(
    source.snapshot().devices.map((d) => d.id),
    [12, 13, 15],
  )

  source.page({ direction: 1 })

  assert.deepEqual(
    source.snapshot().devices.map((d) => d.id),
    [16],
  )

  source.page({ direction: 1 })

  assert.equal(source.snapshot().pageIndex, 0)

  await source.control({ scope: 'output', deviceId: 14, action: 'device', value: 14 })

  assert.equal(source.snapshot().pickerOpen, false)
  assert.ok(calls.every((c) => c[0] === 'get'))
})

test('picker refreshes disconnected choices and closes when no devices remain', async (t) => {
  const { source, current } = fixture(t)

  await source.poll()
  source.view({ open: true, scope: 'output', deviceId: 10 })
  current.output.devices.pop()

  await assert.rejects(
    source.control({ scope: 'output', deviceId: 10, action: 'device', value: 11 }),
    /disconnected/,
  )
  assert.equal(source.snapshot().pickerOpen, true)
  assert.deepEqual(
    source.snapshot().devices.map((d) => d.id),
    [10],
  )

  current.output.devices = []
  await source.poll()

  assert.equal(source.snapshot().pickerOpen, false)
  assert.equal(source.snapshot().status, 'unavailable')
})

test('picker rejects stale open requests and scope selection returns to controls', async (t) => {
  const { source } = fixture(t)

  await source.poll()

  assert.throws(() => source.view({ open: true, scope: 'input', deviceId: 20 }), /changed/)

  source.view({ open: true, scope: 'output', deviceId: 10 })
  source.page({ scope: 'input' })

  assert.equal(source.snapshot().pickerOpen, false)
  assert.equal(source.snapshot().scope, 'input')
})

test('three long device names fit the wire budget', () => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(defaultSettings(), {
      modules: { audio: { enabled: true } },
      device: { activeModule: 'audio' },
    }),
    1,
  )
  store.setSources({
    audio: {
      status: 'ready',
      scope: 'output',
      deviceId: 10,
      pickerOpen: true,
      pageIndex: 1,
      pageCount: 43,
      devices: [10, 11, 12].map((id) => ({ id, name: 'Device '.repeat(30), active: id === 10 })),
    },
  })
  const frame = store.frame()

  assert.equal(frame.dashboard.devices.length, 3)
  assert.ok(frame.dashboard.devices.every((d) => Buffer.byteLength(d.name) <= 64))
  assert.ok(Buffer.byteLength(JSON.stringify(frame) + '\n') <= 2048)
})

test('failed helper reads clear picker data instead of reviving stale rows on swipe', async (t) => {
  const { source } = fixture(t)

  await source.poll()
  source.view({ open: true, scope: 'output', deviceId: 10 })
  source.runner = async () => {
    throw Error('Helper unavailable')
  }
  await source.poll()
  source.page({ direction: 1 })

  assert.equal(source.snapshot().status, 'error')
  assert.equal(source.snapshot().pickerOpen, false)
  assert.equal(source.data, null)
  assert.deepEqual(source.snapshot().devices, [])
})

test('leaving Audio closes the picker and preserves controls when returning', async (t) => {
  const { source } = fixture(t)

  await source.poll()
  source.page({ scope: 'input' })
  source.view({ open: true, scope: 'input', deviceId: 20 })
  source.configure({ enabled: true, active: false })

  assert.equal(source.snapshot().pickerOpen, false)
  assert.deepEqual(source.snapshot().devices, [])

  source.configure({ enabled: true, active: true })

  assert.equal(source.snapshot().pickerOpen, false)
  assert.equal(source.snapshot().scope, 'input')
  assert.equal(source.snapshot().deviceId, 20)
  assert.equal(source.snapshot().volume, 28)
})
