import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setImmediate as turn, setTimeout as delay } from 'node:timers/promises'
import sharp from 'sharp'
import { RoonSource } from '../bridge/roon-source.mjs'

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'roon-source-'))
  const instances = []

  class Api {
    constructor(options) {
      this.options = options
      instances.push(this)
    }

    init_services(value) {
      this.services = value
    }

    start_discovery() {
      this.discovering = true
    }

    stop_discovery() {
      this.discovering = false
    }

    disconnect_all() {
      this.closed = true
    }

    ws_connect(value) {
      this.manualOptions = value

      return {
        transport: {
          close: () => {
            this.manualClosed = true
          },
        },
      }
    }
  }

  const source = new RoonSource({
    pairingPath: path.join(dir, 'pairing.json'),
    dependencies: { RoonApi: Api },
    requestTimeout: 100,
  })
  t.after(async () => {
    source.stop()
    await source.writeQueue
    await rm(dir, { recursive: true, force: true })
  })

  function pair(id = 'core1') {
    let notify
    const images = [],
      controls = []
    const core = {
      core_id: id,
      display_name: 'Living room core',
      services: {
        RoonApiTransport: {
          subscribe_zones(cb) {
            notify = cb
          },

          control(zone, action, cb) {
            controls.push({ zone: zone.zone_id, action, cb })
          },
        },
        RoonApiImage: {
          get_image(key, options, cb) {
            images.push({ key, options, cb })
          },
        },
      },
    }
    instances.at(-1).options.core_paired(core)

    return { core, images, controls, notify: (kind, data) => notify(kind, data) }
  }

  return { source, instances, pair, dir }
}

const zone = (id = 'zone1', image_key) => ({
  zone_id: id,
  display_name: id,
  state: 'playing',
  is_previous_allowed: true,
  is_next_allowed: true,
  now_playing: { image_key, three_line: { line1: 'Song title', line2: 'An artist' } },
})

const enable = async (source) => {
  source.configure({ enabled: true, host: '192.168.50.183', zoneId: '' })
  await source.start()
}

test('Roon stays off when disabled, uses API port9330 and disconnects both transports', async (t) => {
  const { source, instances } = await fixture(t)

  await source.start()

  assert.equal(instances.length, 0)

  source.configure({ enabled: true, host: '192.168.50.183', zoneId: '' })

  for (let i = 0; i < 20 && !instances.length; i++) await turn()

  assert.equal(instances[0].manualOptions.port, 9330)
  assert.notEqual(instances[0].discovering, true)

  source.configure({ enabled: false, host: '192.168.50.183', zoneId: '' })

  assert.equal(instances[0].manualClosed, true)
  assert.equal(instances[0].closed, true)
  assert.equal(source.snapshot().status, 'disabled')
  await assert.rejects(source.control('playpause'), /Connect Roon/)
  assert.throws(
    () => source.configure({ enabled: true, host: 'http://server:55000', zoneId: '' }),
    /hostname/,
  )
})

test('Roon pairing persists privately and ignores callbacks after reconfiguration', async (t) => {
  const { source, instances, dir, pair } = await fixture(t)

  await enable(source)
  const first = instances[0]
  first.options.set_persisted_state({ tokens: { core1: 'private-token' }, paired_core_id: 'core1' })
  await source.writeQueue

  assert.equal((await stat(path.join(dir, 'pairing.json'))).mode & 0o777, 0o600)
  assert.match(await readFile(path.join(dir, 'pairing.json'), 'utf8'), /private-token/)

  const connection = pair()
  connection.notify('Subscribed', { zones: [zone()] })

  assert.doesNotMatch(JSON.stringify(source.snapshot()), /private-token|tokens/)

  source.configure({ enabled: false, host: '', zoneId: '' })
  connection.notify('Changed', { zones_changed: [zone('late')] })
  first.options.core_paired(connection.core)

  assert.equal(source.snapshot().status, 'disabled')
  assert.deepEqual(source.snapshot().zones, [])

  source.configure({ enabled: true, host: '', zoneId: '' })
  const deadline = Date.now() + 2000

  while (instances.length < 2 && Date.now() < deadline) await delay(10)

  assert.equal(instances.length, 2, 'Roon reconnects after loading the saved pairing')
  assert.equal(instances[1].options.get_persisted_state().tokens.core1, 'private-token')
  assert.equal(instances[1].discovering, true)
  assert.equal(instances[1].manualOptions, undefined)
})

test('zones update and explicit missing selection never controls another room', async (t) => {
  const { source, pair } = await fixture(t)

  await enable(source)
  const core = pair()
  core.notify('Subscribed', { zones: [{ ...zone('first'), state: 'paused' }, zone('playing')] })

  assert.equal(source.snapshot().zoneId, 'playing')
  assert.equal(source.snapshot().track, 'Song title')

  source.configure({ enabled: true, host: '192.168.50.183', zoneId: 'first' })

  assert.equal(source.snapshot().zoneId, 'first')

  core.notify('Changed', { zones_removed: ['first'] })

  assert.equal(source.snapshot().zoneId, '')
  await assert.rejects(source.control('next'), /select an available zone/)
  assert.equal(core.controls.length, 0)
})

test('Roon controls validate capabilities and reject stale acknowledgements', async (t) => {
  const { source, pair } = await fixture(t)

  await enable(source)
  const core = pair()
  core.notify('Subscribed', { zones: [zone()] })

  await assert.rejects(source.control('delete'), /Choose previous/)

  const pending = source.control('playpause')

  assert.equal(core.controls[0].action, 'playpause')
  await assert.rejects(source.control('next'), /already pending/)

  core.controls[0].cb(false)
  await pending
  core.notify('Changed', { zones_changed: [{ ...zone(), is_next_allowed: false }] })

  await assert.rejects(source.control('next'), /unavailable/)

  const stale = source.control('previous')
  source.stop()
  core.controls[1].cb(false)

  await assert.rejects(stale, /changed/)
})

test('artwork is converted to bounded RGB565 and stale album/core responses cannot replace it', async (t) => {
  const { source, pair } = await fixture(t)

  await enable(source)
  const core = pair()
  const jpeg = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#ff0000' },
  })
    .jpeg()
    .toBuffer()
  core.notify('Subscribed', { zones: [zone('zone1', 'old')] })
  const oldPromise = source.artPromise
  core.notify('Changed', { zones_changed: [zone('zone1', 'new')] })
  core.images[1].cb(false, 'image/jpeg', jpeg)
  await source.artPromise
  const id = source.snapshot().artId,
    art = await source.artwork(id)

  assert.match(id, /^[a-f0-9]{40}$/)
  assert.ok(art)
  assert.equal(art.pixels.length, 160 * 160 * 2)
  assert.equal(art.width, 160)
  assert.equal(art.pixels.readUInt16LE(0) & 0xf800, 0xf800)
  assert.equal((await sharp(art.bytes).metadata()).format, 'jpeg')

  core.images[0].cb(false, 'image/jpeg', jpeg)
  await oldPromise

  assert.equal(source.snapshot().artId, id)

  core.notify('Changed', { zones_changed: [zone('zone1')] })

  assert.equal(source.snapshot().artId, null)
  assert.equal(await source.artwork(id), null)

  core.notify('Changed', { zones_changed: [zone('zone1', 'late')] })
  const late = source.artPromise
  source.stop()
  core.images[2].cb(false, 'image/jpeg', jpeg)
  await late

  assert.equal(source.snapshot().artId, null)
})

test('unpaired discovery asks for extension authorization, and core loss clears content', async (t) => {
  const { source, instances, pair } = await fixture(t)

  await enable(source)
  await new Promise((resolve) => setTimeout(resolve, 120))

  assert.equal(source.snapshot().status, 'auth-required')
  assert.match(source.snapshot().error, /Settings > Extensions/)

  const old = pair()
  old.notify('Subscribed', { zones: [zone()] })
  const current = pair('core2')
  current.notify('Subscribed', { zones: [zone('current')] })
  instances[0].options.core_unpaired(old.core)

  assert.equal(source.snapshot().zoneId, 'current')

  instances[0].options.core_unpaired(current.core)

  assert.equal(source.snapshot().track, '')
  assert.equal(source.snapshot().status, 'auth-required')
})

test('failed artwork can retry without changing tracks and does not publish every seek', async (t) => {
  const { source, pair } = await fixture(t)

  await enable(source)
  const core = pair()
  core.notify('Subscribed', { zones: [zone('zone1', 'same')] })
  core.images[0].cb('NetworkError')
  await source.artPromise
  let changes = 0
  source.on('change', () => changes++)
  core.notify('Changed', { zones_seek_changed: [{ zone_id: 'zone1', seek_position: 5 }] })

  assert.equal(core.images.length, 1)
  assert.equal(changes, 0)

  source.artRetryAt = 0
  core.notify('Changed', { zones_seek_changed: [{ zone_id: 'zone1', seek_position: 6 }] })

  assert.equal(core.images.length, 2)

  core.images[1].cb('NetworkError')
  await source.artPromise
})

test('disconnect terminates retained sockets after vendor close drops its references', async (t) => {
  const { source, instances } = await fixture(t)

  await enable(source)
  const api = instances[0]
  let terminated = 0

  const connection = () => {
    const transport = {
      ws: {
        terminate() {
          terminated++
        },
      },

      close() {
        this.ws = undefined
      },
    }

    return { transport }
  }

  source.manual = connection()
  api._sood_conns = { discovered: connection() }
  api.disconnect_all = () => {
    for (const conn of Object.values(api._sood_conns)) conn.transport.close()

    api._sood_conns = {}
  }
  source.stop()

  assert.equal(terminated, 2)

  source.stop()

  assert.equal(terminated, 2)
})
