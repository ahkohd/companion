import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import schema from '../shared/design-schema.json' with { type: 'json' }
import { speedDialLayout } from '../shared/speed-dial-layout.mjs'

const cjson = '.tools/esp-idf/components/json/cJSON'
const available = existsSync(path.join(cjson, 'cJSON.c'))
const needsIdf = { skip: !available && 'Run firmware:setup for cJSON' }
let directory, probe
before(async () => {
  if (!available) return

  directory = await mkdtemp(path.join(os.tmpdir(), 'speed-dial-firmware-'))
  probe = path.join(directory, 'probe')
  execFileSync(process.platform === 'darwin' ? '/usr/bin/clang' : 'cc', [
    '-std=c11',
    '-O1',
    '-g',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-Wno-deprecated-declarations',
    '-fsanitize=address,undefined',
    '-I',
    'firmware/main',
    '-I',
    cjson,
    'test/speed-dial-probe.c',
    'firmware/main/display_module.c',
    'firmware/main/speed_dial.c',
    'firmware/main/module_touch.c',
    'firmware/main/screen_rotation.c',
    path.join(cjson, 'cJSON.c'),
    '-lm',
    '-o',
    probe,
  ])
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})
const defaults = Object.fromEntries(schema.speedDial.map((field) => [field.key, field.default]))

const frame = (fields) => ({
  module: 'speedDial',
  moduleIndex: 6,
  moduleCount: 7,
  dashboard: {
    status: 'ready',
    title: 'Speed Dial',
    detail: '',
    layout: 'grid',
    gridSize: 4,
    listRows: 3,
    showLabels: true,
    pageIndex: 0,
    pageCount: 1,
    openToken: 'a'.repeat(40),
    artId: 'b'.repeat(40),
    buttons: [
      { id: 'a', label: 'Launch', color: null, iconIndex: 0, status: 'idle', enabled: true },
    ],
    ...fields,
  },
})

const parse = (frames, sampled = false) =>
  execFileSync(probe, sampled ? ['--sample-rotations'] : [], {
    input: frames.map(JSON.stringify).join('\n') + '\n',
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
    .trim()
    .split('\n')
    .map(JSON.parse)

const buttons = (count) =>
  Array.from({ length: count }, (_, i) => ({
    id: `button_${i}`,
    label: '\u20ac'.repeat(21),
    color: i ? 0xff0000 : null,
    iconIndex: i,
    status: ['idle', 'running', 'success', 'error'][i % 4],
    enabled: i !== 3,
  }))

const layoutFrame = (config, values) => {
  const design = Object.fromEntries(schema.speedDial.map((field, i) => [field.key, values[i]]))
  const capacity = speedDialLayout(config, design).slots.length

  return {
    ...frame({ ...config, buttons: buttons(capacity), pageIndex: 255, pageCount: 256 }),
    design: values,
  }
}

function compare(frames, sampled = false) {
  const results = parse(frames, sampled)
  results.forEach((result, i) => {
    assert.equal(result.kind, 6)
    assert.equal(result.count, frames[i].dashboard.buttons.length)
    assert.equal(result.page, frames[i].dashboard.pageIndex)
    assert.equal(result.pages, frames[i].dashboard.pageCount)

    const design = Object.fromEntries(
      schema.speedDial.map((field, j) => [field.key, frames[i].design[j]]),
    )
    const expected = speedDialLayout(
      { ...frames[i].dashboard, buttonCount: frames[i].dashboard.buttons.length },
      design,
    ).slots

    assert.equal(result.capacity, expected.length)
    assert.deepEqual(
      result.slots,
      expected,
      JSON.stringify({ config: frames[i].dashboard, design }),
    )
  })
}

test(
  'Speed Dial validates both shapes, every layout, atlas offsets, stale targets and 360 touch rotations under sanitizers',
  needsIdf,
  () => {
    const frames = []

    for (const screenShape of ['round', 'rectangular'])
      for (const layout of ['grid', 'list'])
        for (const size of layout === 'grid' ? [0, 4, 6] : [3, 4])
          for (const showLabels of [true, false]) {
            for (const variant of ['default', 'min', 'max']) {
              const design = schema.speedDial.map((field) => field[variant])
              frames.push(
                layoutFrame(
                  {
                    screenShape,
                    layout,
                    gridSize: layout === 'grid' ? size : 0,
                    listRows: layout === 'list' ? size : 3,
                    showLabels,
                  },
                  design,
                ),
              )
            }
          }

    compare(frames)
    const empty = parse([frame({ gridSize: 0, buttons: [] })])[0]

    assert.deepEqual(empty.slots, [])
    assert.equal(empty.capacity, 7)

    const [round, rectangular] = parse([
      frame({ gridSize: 0 }),
      frame({ gridSize: 0, screenShape: 'rectangular' }),
    ])

    assert.equal(round.capacity, 7)
    assert.equal(rectangular.capacity, 9)
  },
)

test(
  'native packed geometry matches mixed extrema and 500 deterministic random designs while keeping all targets separated',
  needsIdf,
  () => {
    let seed = 847321

    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0

      return seed / 2 ** 32
    }

    const designs = []

    for (let mask = 0; mask < 32; mask++)
      designs.push(schema.speedDial.map((field, i) => field[(mask >> i) & 1 ? 'max' : 'min']))

    for (let i = 0; i < 500; i++)
      designs.push(
        schema.speedDial.map((field) =>
          Math.floor(field.min + random() * (field.max - field.min + 1)),
        ),
      )

    for (const screenShape of ['round', 'rectangular'])
      for (const showLabels of [true, false]) {
        const frames = designs.map((design) =>
          layoutFrame(
            { layout: 'grid', gridSize: 0, listRows: 3, screenShape, showLabels },
            design,
          ),
        )
        compare(frames, true)

        if (screenShape === 'round' && !showLabels)
          compare(
            frames.map((f) => ({
              ...f,
              dashboard: { ...f.dashboard, pageIndex: 0, pageCount: 1 },
            })),
            true,
          )
      }
  },
)

test(
  'Speed Dial rejects malformed fields, unsafe identifiers, duplicates and oversize UTF8 without overflow',
  needsIdf,
  () => {
    const invalid = []

    for (const key of [
      'layout',
      'gridSize',
      'listRows',
      'showLabels',
      'openToken',
      'artId',
      'pageIndex',
      'pageCount',
      'buttons',
    ]) {
      const value = frame()
      delete value.dashboard[key]
      invalid.push(value)
    }

    for (const fields of [
      { layout: 'other' },
      { layout: 0 },
      { screenShape: 'square' },
      { screenShape: null },
      { screenShape: 1 },
      { gridSize: 5 },
      { gridSize: 4.5 },
      { gridSize: '4' },
      { listRows: 2 },
      { listRows: 3.2 },
      { showLabels: 1 },
      { pageIndex: -1 },
      { pageIndex: 1 },
      { pageCount: 0 },
      { pageCount: 257 },
      { pageCount: null },
      { pageIndex: 0.5 },
      { openToken: 'A'.repeat(40) },
      { openToken: 'a'.repeat(41) },
      { artId: '' },
      { artId: 'x'.repeat(40) },
      { buttons: null },
      { buttons: {} },
      { buttons: [null] },
      { status: 'error' },
    ])
      invalid.push(frame(fields))

    const button = frame().dashboard.buttons[0]

    for (const key of Object.keys(button)) {
      const value = { ...button }
      delete value[key]
      invalid.push(frame({ buttons: [value] }))
    }

    for (const fields of [
      { id: '' },
      { id: 'a'.repeat(49) },
      { id: 'bad"id' },
      { id: 'bad/id' },
      { id: 'bad id' },
      { id: '\u00e9' },
      { label: 'x'.repeat(25) },
      { label: '\u20ac'.repeat(22) },
      { label: 'hello\nworld' },
      { label: null },
      { color: -1 },
      { color: 0x1000000 },
      { color: 1.5 },
      { color: 'red' },
      { color: false },
      { iconIndex: 13 },
      { iconIndex: -1 },
      { iconIndex: 0.5 },
      { enabled: 1 },
      { status: 'pending' },
      { status: null },
    ])
      invalid.push(frame({ buttons: [{ ...button, ...fields }] }))

    invalid.push(frame({ buttons: [button, button] }))
    invalid.push(
      frame({ buttons: Array.from({ length: 5 }, (_, i) => ({ ...button, id: `id-${i}` })) }),
    )
    invalid.push(
      frame({
        layout: 'list',
        buttons: Array.from({ length: 4 }, (_, i) => ({ ...button, id: `id-${i}` })),
      }),
    )
    invalid.push(
      frame({
        gridSize: 6,
        buttons: Array.from({ length: 7 }, (_, i) => ({ ...button, id: `id-${i}` })),
      }),
    )
    invalid.push(frame({ gridSize: 0, buttons: buttons(8) }))
    invalid.push(frame({ gridSize: 0, screenShape: 'rectangular', buttons: buttons(10) }))

    assert.deepEqual(
      parse(invalid),
      invalid.map(() => null),
    )

    const limits = parse([
      frame({
        buttons: [{ ...button, id: 'x'.repeat(48), label: 'x'.repeat(24), color: 0xffffff }],
      }),
      frame({ buttons: [{ ...button, label: '\ud83d\ude00'.repeat(16) }] }),
    ])

    assert.ok(limits.every(Boolean))

    for (const bytes of [
      [0x80],
      [0xc0, 0x80],
      [0xc2],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
    ]) {
      const input = Buffer.from(
        JSON.stringify(frame({ buttons: [{ ...button, label: 'INSERT' }] })) + '\n',
      )
      const offset = input.indexOf('INSERT')
      const raw = Buffer.concat([
        input.subarray(0, offset),
        Buffer.from(bytes),
        input.subarray(offset + 6),
      ])

      assert.equal(execFileSync(probe, [], { input: raw, encoding: 'utf8' }).trim(), 'null')
    }
  },
)

test(
  'partial automatic pages retain centre-first rendering and touch indexes for every button count',
  needsIdf,
  () => {
    const config = {
      layout: 'grid',
      gridSize: 0,
      listRows: 3,
      screenShape: 'round',
      showLabels: false,
    }

    for (const pageCount of [1, 2]) {
      const frames = Array.from({ length: 13 }, (_, i) =>
        frame({ ...config, pageCount, buttons: buttons(i + 1) }),
      )
      const results = parse(frames)
      results.forEach((result, i) => {
        const expected = speedDialLayout(
          { ...config, pageCount, buttonCount: i + 1 },
          defaults,
        ).slots

        assert.equal(result.capacity, 13)
        assert.equal(result.count, i + 1)
        assert.deepEqual(result.slots, expected.slice(0, i + 1))
      })
    }
  },
)
