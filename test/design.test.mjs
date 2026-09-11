import { resolveDeviceAppearance } from '../shared/device-appearance.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import schema from '../shared/design-schema.json' with { type: 'json' }
import {
  defaultSettings,
  mergeSettings,
  validateSettings,
  StudioSettings,
} from '../bridge/studio-settings.mjs'
import { FaceStore } from '../bridge/store.mjs'
import { DeviceLink } from '../bridge/device.mjs'
import { dashboardFor } from '../bridge/dashboard.mjs'

const hey = (count = 30) => ({
  hey: {
    status: 'ready',
    selectedBox: 'imbox',
    items: Array.from({ length: count }, (_, id) => ({
      sender: `Sender ${id}`,
      subject: `Subject ${id}`,
    })),
  },
})

test('design validation enforces every field, option, integer and key', () => {
  for (const [module, fields] of Object.entries(schema))
    for (const field of fields) {
      for (const value of field.options ?? [field.min, field.default, field.max]) {
        assert.equal(
          mergeSettings(defaultSettings(), { design: { [module]: { [field.key]: value } } }).design[
            module
          ][field.key],
          value,
        )
      }

      const invalid = [
        null,
        true,
        '1',
        NaN,
        Infinity,
        -Infinity,
        field.min - 1,
        field.max + 1,
        field.default + 0.5,
      ]

      if (field.options)
        for (let i = field.min; i <= field.max; i++)
          if (!field.options.includes(i)) {
            invalid.push(i)
            break
          }

      for (const value of invalid)
        assert.throws(() =>
          mergeSettings(defaultSettings(), { design: { [module]: { [field.key]: value } } }),
        )

      const missing = defaultSettings()
      delete missing.design[module][field.key]

      assert.throws(() => validateSettings(missing))
    }

  for (const design of [null, [], { bogus: {} }, { hey: { nope: 1 } }])
    assert.throws(() => mergeSettings(defaultSettings(), { design }))

  const extra = defaultSettings()
  extra.design.hey.nope = 1

  assert.throws(() => validateSettings(extra))
})

test('older settings acquire designer defaults and partial design saves persist in order', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-settings-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'settings.json'),
    old = defaultSettings()
  delete old.design
  old.appearance.theme = 'dark'
  await writeFile(filePath, JSON.stringify(old))
  const store = new FaceStore(),
    settings = new StudioSettings(store, { filePath })

  await settings.load()

  assert.deepEqual(store.settings.design, defaultSettings().design)
  assert.equal(store.settings.appearance.theme, 'dark')

  await Promise.all([
    settings.save({ design: { hey: { rows: 1 } } }),
    settings.save({ design: { clock: { timeSize: 56 } } }),
  ])
  const restarted = new FaceStore()
  await new StudioSettings(restarted, { filePath }).load()

  assert.equal(restarted.settings.design.hey.rows, 1)
  assert.equal(restarted.settings.design.clock.timeSize, 56)
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), restarted.settings)
})

test('HEY designer rows paginate all messages and clamp after row or source changes', () => {
  for (const rows of [1, 2, 3]) {
    const settings = mergeSettings(defaultSettings(), { design: { hey: { rows } } }),
      seen = []

    for (let page = 0; page < Math.ceil(7 / rows); page++) {
      const { dashboard } = dashboardFor('hey', hey(7), settings, 0, 0, page)

      assert.equal(dashboard.pageCount, Math.ceil(7 / rows))
      assert.ok(dashboard.items.length <= rows)

      seen.push(...dashboard.items)
    }

    assert.deepEqual(seen, hey(7).hey.items)
  }

  const store = new FaceStore()

  store.setSettings(
    mergeSettings(store.settings, {
      modules: { hey: { enabled: true } },
      device: { activeModule: 'hey' },
      design: { hey: { rows: 1 } },
    }),
  )
  store.setSources(hey(7))
  store.cycleHey(-1)

  assert.equal(store.heyPage, 6)

  store.setSettings(mergeSettings(store.settings, { design: { hey: { rows: 3 } } }))

  assert.equal(store.heyPage, 2)
  assert.equal(store.frame().dashboard.items[0].sender, 'Sender 6')

  store.setSources({ hey: { ...hey(7).hey, refreshing: true } })

  assert.equal(store.heyPage, 2)

  store.setSources(hey(3))

  assert.equal(store.heyPage, 0)

  const legacy = defaultSettings()
  delete legacy.design

  assert.equal(dashboardFor('hey', hey(7), legacy).dashboard.items.length, 2)
})

test('wire includes only active themed design in stable schema order and fits 2048 bytes', () => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(store.settings, {
      modules: {
        usage: { enabled: true },
        hey: { enabled: true },
        clock: { enabled: true },
        roon: { enabled: true },
        audio: { enabled: true },
        speedDial: { enabled: true },
      },
    }),
  )
  store.setPointer({
    enabled: true,
    status: 'active',
    x: -0.12345678901234567,
    y: 0.12345678901234567,
  })
  store.ingest([{ pane_id: 'escaped', agent: 'pi', agent_status: 'working', name: '"'.repeat(64) }])
  store.select('escaped')
  store.setSources({
    hey: {
      ...hey().hey,
      refreshing: true,
      items: hey().hey.items.map((item) => ({
        ...item,
        url: 'https://app.hey.com/topics/' + item.id,
        sender: '"'.repeat(240),
        subject: '"'.repeat(240),
      })),
    },
    usage: {
      status: 'ready',
      providers: [
        {
          id: 'codex',
          label: '"'.repeat(64),
          windows: [1, 2].map((id) => ({
            id: String(id),
            label: '"'.repeat(64),
            usedPercent: 99,
            resetAt: 9999999999999,
          })),
        },
      ],
    },
  })

  for (const module of Object.keys(schema)) {
    store.setModule(module)

    assert.equal(store.frame().theme, 'dark')
  }

  const design = Object.fromEntries(
    Object.entries(schema).map(([module, fields]) => [
      module,
      Object.fromEntries(
        fields.map((field) => [field.key, field.options ? field.options.at(-1) : field.max]),
      ),
    ]),
  )
  store.setSettings(mergeSettings(store.settings, { design }))
  store.seq = 4294967295
  store.animationEpoch = 4294967295

  for (const module of Object.keys(schema)) {
    store.setModule(module)
    const frame = store.frame()

    assert.deepEqual(
      frame.design,
      schema[module].map(
        (field) => resolveDeviceAppearance(store.settings).design[module][field.key],
      ),
    )
    assert.ok(Buffer.byteLength(JSON.stringify(frame) + '\n') <= 2048)
  }
})

test('device sends larger design frames and reports oversized updates without a feedback loop', () => {
  const store = new FaceStore(),
    link = new DeviceLink(store),
    sent = []
  link.ready = true
  link.port = {
    isOpen: true,

    write(frame, cb) {
      sent.push(frame)
      cb()
    },
  }

  store.on('change', link.onChange)
  store.frame = () => ({ seq: store.seq, content: 'x'.repeat(1500) })
  link.send()

  assert.equal(sent.length, 1)

  store.frame = () => ({ seq: store.seq, content: 'x'.repeat(4096) })
  store.seq++
  link.send()

  assert.equal(sent.length, 1)
  assert.match(store.device.error, /maximum 4096/)

  store.frame = () => ({ seq: store.seq })
  store.seq++
  link.send()

  assert.equal(sent.length, 2)
  assert.equal(store.device.error, null)
})

test('device diagnostics accept custom Face status positions and retain module defaults', () => {
  const store = new FaceStore(),
    link = new DeviceLink(store)
  link.ready = true

  store.setSettings(mergeSettings(store.settings, { design: { face: { titleOffset: -20 } } }))
  const ack = {
    type: 'ack',
    v: 1,
    seq: store.seq,
    rendered_seq: store.seq,
    render_us: 100,
    eyes: [
      [50, 50],
      [50, 50],
    ],
    text_gap: 8,
    module: 'face',
    status_top: 340,
    name_shimmer_pixels: 22800,
  }
  link.receive(JSON.stringify(ack) + '\n')

  assert.equal(store.device.renderedStatusTop, 340)
  assert.equal(store.device.renderedNameShimmerPixels, 22800)

  link.receive(JSON.stringify({ ...ack, module: 'hey', status_top: 360 }) + '\n')

  assert.equal(store.device.renderedStatusTop, 360)

  link.receive(JSON.stringify({ ...ack, status_top: -999, name_shimmer_pixels: 22801 }) + '\n')

  assert.equal(store.device.renderedStatusTop, 360)
  assert.equal(store.device.renderedNameShimmerPixels, 22800)
})

test('font controls accept each integer size and keep the percentage automatic sentinel', () => {
  for (const [module, fields] of Object.entries(schema))
    for (const field of fields.filter((f) => /Size$/.test(f.key))) {
      for (let value = field.min; value <= field.max; value++)
        assert.equal(
          mergeSettings(defaultSettings(), { design: { [module]: { [field.key]: value } } }).design[
            module
          ][field.key],
          value,
        )
    }

  assert.equal(
    mergeSettings(defaultSettings(), { design: { usage: { numberSize: 0 } } }).design.usage
      .numberSize,
    0,
  )

  for (let value = 1; value < 24; value++)
    assert.throws(() =>
      mergeSettings(defaultSettings(), { design: { usage: { numberSize: value } } }),
    )
})

test('device font allocation failures are reported and cleared after recovery', () => {
  const store = new FaceStore(),
    link = new DeviceLink(store)
  link.ready = true
  const ack = {
    type: 'ack',
    v: 1,
    seq: store.seq,
    rendered_seq: store.seq,
    render_us: 100,
    eyes: [
      [10, 10],
      [10, 10],
    ],
    module: 'face',
  }

  link.receive(JSON.stringify({ ...ack, font_error: true }) + '\n')

  assert.equal(store.device.fontError, true)

  link.receive(JSON.stringify({ ...ack, font_error: 'false' }) + '\n')

  assert.equal(store.device.fontError, true)

  link.receive(JSON.stringify({ ...ack, font_error: false }) + '\n')

  assert.equal(store.device.fontError, false)
})

test('legacy Roon designs gain opt-in motion without losing their saved layout', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'roon-design-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const filePath = path.join(dir, 'settings.json')
  const old = defaultSettings()
  old.design.roon.controlSize = 48
  old.design.roon.artY = 81
  delete old.design.roon.animateArtwork
  delete old.design.roon.spinArtwork
  await writeFile(filePath, JSON.stringify(old))
  const settings = new StudioSettings(new FaceStore(), { filePath })

  await settings.load()

  assert.equal(settings.value.design.roon.controlSize, 48)
  assert.equal(settings.value.design.roon.artY, 81)
  assert.equal(settings.value.design.roon.animateArtwork, 0)
  assert.equal(settings.value.design.roon.spinArtwork, 0)

  await settings.save({ design: { roon: { controlSize: 72, animateArtwork: 1, spinArtwork: 1 } } })
  const restored = new StudioSettings(new FaceStore(), { filePath })
  await restored.load()

  assert.deepEqual(restored.value.design.roon, settings.value.design.roon)
})
