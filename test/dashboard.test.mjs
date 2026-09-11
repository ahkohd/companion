import test from 'node:test'
import assert from 'node:assert/strict'
import { dashboardFor } from '../bridge/dashboard.mjs'
import { mailWireText } from '../bridge/mail-text.mjs'
import { FaceStore } from '../bridge/store.mjs'
import { defaultSettings, mergeSettings } from '../bridge/studio-settings.mjs'

test('usage preserves actual provider windows and never invents missing session usage', () => {
  const sources = {
    usage: {
      status: 'ready',
      providers: [
        {
          id: 'codex',
          label: 'Codex',
          windows: [
            { id: 'secondary', label: 'Weekly', usedPercent: 12, resetAt: 1000 + 25 * 3600000 },
          ],
        },
      ],
    },
  }
  const { dashboard } = dashboardFor('usage', sources, defaultSettings(), 1000)

  assert.equal(dashboard.title, '')
  assert.equal(dashboard.primary.provider, 'Codex')
  assert.equal(dashboard.primary.label, 'Weekly')
  assert.equal(dashboard.primary.remaining, 88)
  assert.equal(dashboard.primary.reset, 'Resets in 1d 1h')
  assert.equal(dashboard.secondary, undefined)

  const missing = dashboardFor(
    'usage',
    { usage: { status: 'ready', providers: [] } },
    defaultSettings(),
  )

  assert.equal(missing.dashboard.status, 'unavailable')
  assert.equal(missing.dashboard.primary, undefined)

  const empty = dashboardFor(
    'usage',
    { usage: { status: 'ready', providers: [{ id: 'codex', label: 'Codex', windows: [] }] } },
    defaultSettings(),
  )

  assert.equal(empty.dashboard.status, 'unavailable')
  assert.equal(empty.dashboard.title, '')
  assert.equal(empty.dashboard.primary, undefined)
  assert.equal(empty.dashboard.secondary, undefined)
  assert.equal(empty.label, '')
  assert.equal(empty.name, '')
  assert.equal(empty.dashboard.detail, 'No usage available')
})

const mailItems = (count = 7) =>
  Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    sender: `Sender ${index + 1}`,
    subject: `Subject ${index + 1}`,
  }))

const heySource = (items = mailItems()) => ({
  hey: { status: 'ready', selectedBox: 'imbox', items, hasMore: true },
})

test('HEY presents two sender and subject rows per page without leaking ids or other metadata', () => {
  const settings = defaultSettings(),
    sources = heySource()
  const first = dashboardFor('hey', sources, settings).dashboard

  assert.equal(first.title, 'Imbox')
  assert.equal(first.detail, '')
  assert.equal(first.pageCount, 4)
  assert.equal(first.pageIndex, 0)
  assert.deepEqual(
    first.items,
    mailItems(2).map(({ sender, subject }) => ({ sender, subject })),
  )

  const last = dashboardFor('hey', sources, settings, 1000, 0, 99).dashboard

  assert.equal(last.pageIndex, 3)
  assert.deepEqual(last.items, [{ sender: 'Sender 7', subject: 'Subject 7' }])

  settings.modules.hey.box = 'feed'
  const changed = dashboardFor('hey', sources, settings).dashboard

  assert.equal(changed.status, 'unavailable')
  assert.equal(changed.items, undefined)
})

test('HEY two-message pages cover every collected message without gaps or duplicates', () => {
  for (const count of [0, 1, 2, 3, 7, 30, 31]) {
    const settings = defaultSettings(),
      sources = heySource(mailItems(count)),
      seen = []
    const pageCount = Math.max(1, Math.ceil(Math.min(count, 30) / 2))

    for (let page = 0; page < pageCount; page++) {
      const dashboard = dashboardFor('hey', sources, settings, 1000, 0, page).dashboard

      assert.equal(dashboard.pageCount, pageCount)
      assert.equal(dashboard.pageIndex, page)
      assert.ok(dashboard.items.length <= 2)

      seen.push(...dashboard.items)
    }

    assert.deepEqual(
      seen,
      mailItems(Math.min(count, 30)).map(({ sender, subject }) => ({ sender, subject })),
    )
  }
})

test('HEY distinguishes an empty mailbox from unavailable or failed data', () => {
  const empty = dashboardFor('hey', heySource([]), defaultSettings()).dashboard

  assert.equal(empty.status, 'ready')
  assert.deepEqual(empty.items, [])
  assert.equal(empty.detail, 'You are all caught up')

  const malformed = dashboardFor(
    'hey',
    { hey: { status: 'ready', selectedBox: 'imbox' } },
    defaultSettings(),
  ).dashboard

  assert.equal(malformed.status, 'unavailable')
  assert.equal(malformed.items, undefined)

  for (const status of ['disabled', 'loading', 'missing', 'auth-required', 'error']) {
    const { dashboard } = dashboardFor(
      'hey',
      { hey: { ...heySource().hey, status } },
      defaultSettings(),
    )

    assert.equal(dashboard.items, undefined)
    assert.notEqual(dashboard.status, 'ready')
  }
})

test('every module frame fits the serial limit and excludes unneeded source data', () => {
  const store = new FaceStore()

  store.ingest([{ pane_id: 'a', agent: 'pi', agent_status: 'working', name: '"'.repeat(64) }])
  store.select('a')
  store.seq = 4294967295
  store.animationEpoch = 4294967295
  store.setSettings(
    mergeSettings(store.settings, {
      modules: { usage: { enabled: true }, hey: { enabled: true }, clock: { enabled: true } },
    }),
  )
  store.setSources({
    usage: {
      status: 'ready',
      refreshing: true,
      privateAccount: 'not for the wire',
      providers: [
        {
          id: 'codex',
          label: '"'.repeat(64),
          windows: [
            { id: 'a', label: '"'.repeat(64), usedPercent: 0.25, resetAt: 9999999999999 },
            { id: 'b', label: '"'.repeat(64), usedPercent: 99.99, resetAt: 9999999999999 },
            { id: 'extra', label: 'Do not send', usedPercent: 0, resetAt: null },
          ],
        },
      ],
    },
    hey: { ...heySource().hey, refreshing: true },
  })

  for (const module of ['face', 'usage', 'hey', 'clock']) {
    store.setModule(module)
    const frame = store.frame()
    const serialized = JSON.stringify(frame) + '\n'

    assert.ok(
      Buffer.byteLength(serialized) <= 2048,
      `${module}: ${Buffer.byteLength(serialized)} bytes`,
    )
    assert.equal(frame.moduleIndex, store.settings.device.moduleOrder.indexOf(module))
    assert.equal(frame.moduleCount, 4)
    assert.doesNotMatch(serialized, /privateAccount|not for the wire|Do not send/)

    if (module === 'hey') {
      assert.equal(frame.dashboard.items.length, 2)
      assert.equal(frame.dashboard.items[0].sender, 'Sender 1')
    }
  }
})

test('usage labels fit the round display without repeating the provider heading', () => {
  const source = {
    usage: {
      status: 'ready',
      providers: [
        {
          id: 'codex',
          label: 'Codex',
          windows: [
            { id: 'spark', label: 'Codex Spark 5-hour', usedPercent: 5, resetAt: null },
            { id: 'weekly', label: 'Weekly', usedPercent: 20, resetAt: null },
          ],
        },
      ],
    },
  }
  const { dashboard } = dashboardFor('usage', source, defaultSettings())

  assert.equal(dashboard.primary.label, 'Spark 5h')
  assert.equal(dashboard.secondary.label, 'Weekly')
  assert.equal(dashboard.primary.remaining, 95)
})

const allUsage = () => ({
  usage: {
    status: 'ready',
    providers: [
      {
        id: 'codex',
        label: 'Codex',
        windows: [
          { id: 'primary', label: 'Session', usedPercent: 20, resetAt: null },
          { id: 'secondary', label: 'Weekly', usedPercent: 30, resetAt: null },
          { id: 'spark', label: 'Codex Spark 5-hour', usedPercent: 40, resetAt: null },
        ],
      },
      {
        id: 'claude',
        label: 'Claude',
        windows: [
          { id: 'primary', label: 'Session', usedPercent: 50, resetAt: null },
          { id: 'secondary', label: 'Weekly', usedPercent: 60, resetAt: null },
        ],
      },
    ],
  },
})

test('automatic usage pages include every provider and extra window in source order', () => {
  const sources = allUsage(),
    seen = []

  for (let page = 0; page < 3; page++) {
    const display = dashboardFor('usage', sources, defaultSettings(), 1000, page)

    assert.equal(display.label, '')
    assert.equal(display.name, '')
    assert.equal(display.dashboard.title, '')
    assert.equal(display.dashboard.pageIndex, page)
    assert.equal(display.dashboard.pageCount, 3)

    seen.push(
      ...[display.dashboard.primary, display.dashboard.secondary]
        .filter(Boolean)
        .map((metric) => [metric.provider, metric.label, metric.remaining]),
    )
  }

  assert.deepEqual(seen, [
    ['Codex', 'Session', 80],
    ['Codex', 'Weekly', 70],
    ['Codex', 'Spark 5h', 60],
    ['Claude', 'Session', 50],
    ['Claude', 'Weekly', 40],
  ])

  const last = dashboardFor('usage', sources, defaultSettings(), 1000, 100).dashboard

  assert.equal(last.pageIndex, 2)
  assert.equal(last.secondary, undefined)
})

test('an explicit usage provider filters its pages without substituting another provider', () => {
  const settings = defaultSettings()
  settings.modules.usage.provider = 'claude'
  const sources = allUsage()
  const selected = dashboardFor('usage', sources, settings).dashboard

  assert.equal(selected.pageCount, 1)
  assert.equal(selected.primary.provider, 'Claude')
  assert.equal(selected.secondary.label, 'Weekly')

  settings.modules.usage.provider = 'gemini'
  const missing = dashboardFor('usage', sources, settings).dashboard

  assert.equal(missing.status, 'unavailable')
  assert.equal(missing.primary, undefined)
  assert.equal(missing.detail, 'No usage available')
  assert.equal(sources.usage.providers.length, 2)
})

test('usage paging wraps, survives refreshes and module switches, and clamps when windows shrink', () => {
  const store = new FaceStore()

  store.setSettings(mergeSettings(store.settings, { modules: { usage: { enabled: true } } }))
  store.setSources(allUsage())
  store.setModule('usage')
  const revision = store.settingsRevision,
    settings = structuredClone(store.settings)
  store.cycleUsage(-1)

  assert.equal(store.display().dashboard.pageIndex, 2)

  store.cycleUsage(1)

  assert.equal(store.display().dashboard.pageIndex, 0)

  store.cycleUsage(1)
  store.cycleUsage(1)

  assert.equal(store.display().dashboard.primary.provider, 'Claude')

  store.setSources({ usage: { ...allUsage().usage, status: 'loading' } })

  assert.throws(() => store.cycleUsage(1), /more than one page/)
  assert.equal(store.usagePage, 2)

  store.setSources({ usage: { ...allUsage().usage, status: 'error' } })

  assert.equal(store.usagePage, 2)

  store.setSources(allUsage())

  assert.equal(store.display().dashboard.pageIndex, 2)

  store.setModule('face')

  assert.throws(() => store.cycleUsage(1), /more than one page/)

  store.setModule('usage')

  assert.equal(store.display().dashboard.pageIndex, 2)

  store.setSettings(mergeSettings(store.settings, { device: { swipeEnabled: false } }))
  store.cycleUsage(-1)

  assert.equal(store.usagePage, 1)

  store.cycleUsage(1)

  assert.equal(store.usagePage, 2)

  const fewer = allUsage()
  fewer.usage.providers.pop()
  store.setSources(fewer)

  assert.equal(store.display().dashboard.pageIndex, 1)
  assert.equal(store.display().dashboard.pageCount, 2)
  assert.equal(store.snapshot().modules.usage.providers[0].windows.length, 3)
  assert.equal(store.settingsRevision, revision)
  assert.equal(store.settings.device.activeModule, settings.device.activeModule)
  assert.equal(Object.hasOwn(store.settings.device, 'usagePage'), false)

  store.setSettings(mergeSettings(store.settings, { modules: { usage: { provider: 'claude' } } }))

  assert.equal(store.usagePage, 0)
  assert.equal(store.display().dashboard.status, 'unavailable')

  store.setSources(allUsage())

  assert.equal(store.display().dashboard.primary.provider, 'Claude')

  for (const invalid of [undefined, null, '1', '-1', 0, 2, -2, [], {}])
    assert.throws(() => store.cycleUsage(invalid), /page direction/)

  assert.throws(() => store.cycleUsage(1), /more than one page/)
})

test('dashboard modules have no global captions while errors retain their detail', () => {
  for (const module of ['usage', 'hey'])
    for (const status of ['disabled', 'loading', 'missing', 'auth-required', 'error']) {
      const display = dashboardFor(module, { [module]: { status } }, defaultSettings())

      assert.equal(display.label, '')
      assert.equal(display.name, '')
      assert.ok(display.dashboard.detail)
      assert.equal(display.dashboard.primary, undefined)
      assert.equal(display.dashboard.count, undefined)
    }
})

test('paged usage frames bound provider text and metadata within the serial budget', (t) => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(store.settings, {
      modules: { usage: { enabled: true } },
      device: { activeModule: 'usage' },
    }),
  )
  t.mock.method(performance, 'now', () => 4294967295)
  store.setPointer({
    enabled: true,
    status: 'active',
    x: -0.12345678901234567,
    y: 0.12345678901234567,
  })

  for (const label of ['"'.repeat(64), '\\'.repeat(64), '\u{1f600}'.repeat(32)]) {
    const source = {
      usage: {
        status: 'ready',
        refreshing: true,
        providers: [
          {
            id: 'codex',
            label,
            windows: Array.from({ length: 512 }, (_, index) => ({
              id: String(index),
              label,
              usedPercent: 1.23,
              resetAt: 9999999999999,
            })),
          },
        ],
      },
    }
    store.setSources(source)
    store.cycleUsage(-1)
    store.seq = 4294967295
    store.animationEpoch = 4294967295
    store.changedAt = 0
    const frame = store.frame(),
      text = JSON.stringify(frame) + '\n'

    assert.equal(frame.dashboard.pageIndex, 255)
    assert.equal(frame.dashboard.pageCount, 256)
    assert.equal(frame.dashboard.refreshing, true)
    assert.ok(Buffer.byteLength(frame.dashboard.primary.provider) <= 16)
    assert.ok(Buffer.byteLength(frame.dashboard.primary.label) <= 16)
    assert.doesNotMatch(frame.dashboard.primary.provider, /\ufffd/)
    assert.ok(Buffer.byteLength(text) <= 2048, `${Buffer.byteLength(text)} bytes`)

    store.usagePage = 0
  }
})

test('refresh hints only accompany ready cards and usage pages remain navigable while checking', () => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(store.settings, {
      modules: { usage: { enabled: true } },
      device: { activeModule: 'usage' },
    }),
  )
  store.setSources(allUsage())
  store.cycleUsage(-1)
  const sources = allUsage()
  sources.usage.refreshing = true
  store.setSources(sources)

  assert.equal(store.frame().dashboard.pageIndex, 2)
  assert.equal(store.frame().dashboard.refreshing, true)

  store.cycleUsage(1)

  assert.equal(store.frame().dashboard.pageIndex, 0)

  sources.usage.refreshing = false
  store.setSources(sources)

  assert.equal(store.frame().dashboard.refreshing, undefined)

  for (const module of ['usage', 'hey'])
    for (const status of ['loading', 'error', 'auth-required', 'disabled']) {
      const dashboard = dashboardFor(
        module,
        { [module]: { status, refreshing: true } },
        defaultSettings(),
      ).dashboard

      assert.equal(dashboard.refreshing, undefined)
      assert.notEqual(dashboard.status, 'ready')
    }

  const unavailable = dashboardFor(
    'usage',
    { usage: { status: 'ready', refreshing: true, providers: [] } },
    defaultSettings(),
  ).dashboard

  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.refreshing, undefined)

  const hey = dashboardFor(
    'hey',
    { hey: { ...heySource().hey, refreshing: true } },
    defaultSettings(),
  ).dashboard

  assert.equal(hey.refreshing, true)
  assert.equal(hey.items.length, 2)
})

test('HEY pages wrap, survive checking and module switches, and reset or clamp on list changes', () => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(store.settings, {
      modules: { hey: { enabled: true } },
      device: { activeModule: 'hey', swipeEnabled: false },
    }),
  )
  store.setSources(heySource())
  store.cycleHey(-1)

  assert.equal(store.heyPage, 3)

  store.cycleHey(1)

  assert.equal(store.heyPage, 0)

  store.cycleHey(1)

  assert.equal(store.display().dashboard.items[0].sender, 'Sender 3')

  store.setSources({ hey: { ...heySource().hey, refreshing: true } })

  assert.equal(store.heyPage, 1)
  assert.equal(store.display().dashboard.refreshing, true)

  store.cycleHey(1)

  assert.equal(store.heyPage, 2)

  store.setModule('face')

  assert.throws(() => store.cycleHey(1), /more than one page/)

  store.setModule('hey')

  assert.equal(store.heyPage, 2)

  store.setSources({ hey: { ...heySource().hey, status: 'loading' } })

  assert.throws(() => store.cycleHey(1), /more than one page/)
  assert.equal(store.heyPage, 2)

  store.setSources(heySource(mailItems(4)))

  assert.equal(store.heyPage, 1)

  const settingsBeforePages = structuredClone(store.settings),
    revision = store.settingsRevision
  store.cycleHey(-1)

  assert.deepEqual(store.settings, settingsBeforePages)
  assert.equal(store.settingsRevision, revision)

  for (const direction of [undefined, null, '1', 0, 2, -2])
    assert.throws(() => store.cycleHey(direction), /page direction/)

  store.cycleHey(1)
  store.setSettings(mergeSettings(store.settings, { modules: { hey: { box: 'feed' } } }))

  assert.equal(store.heyPage, 0)
  assert.equal(store.display().dashboard.status, 'unavailable')

  store.setSources({ hey: { ...heySource().hey, selectedBox: 'feed', items: [] } })

  assert.equal(store.display().dashboard.detail, 'Nothing here yet')
  assert.throws(() => store.cycleHey(1), /more than one page/)
})

test('HEY text remains valid UTF-8 and two maximally escaped rows fit the USB frame budget', (t) => {
  const store = new FaceStore()

  store.setSettings(
    mergeSettings(store.settings, {
      modules: { usage: { enabled: true }, hey: { enabled: true, box: 'paperTrail' } },
      device: { activeModule: 'hey' },
    }),
  )
  t.mock.method(performance, 'now', () => 4294967295)
  store.setPointer({
    enabled: true,
    status: 'active',
    x: -0.12345678901234567,
    y: 0.12345678901234567,
  })

  for (const value of [
    '"'.repeat(240),
    '\\'.repeat(240),
    'é'.repeat(120),
    '界'.repeat(120),
    '\u{1f600}'.repeat(120),
  ]) {
    store.setSources({
      hey: {
        status: 'ready',
        refreshing: true,
        selectedBox: 'paperTrail',
        hasMore: true,
        items: mailItems(30).map((item) => ({ ...item, sender: value, subject: value })),
      },
    })
    store.heyPage = 14
    store.seq = 4294967295
    store.animationEpoch = 4294967295
    store.changedAt = 0
    const frame = store.frame(),
      text = JSON.stringify(frame) + '\n'

    assert.equal(frame.dashboard.pageIndex, 14)
    assert.equal(frame.dashboard.pageCount, 15)
    assert.deepEqual(frame.dashboard.items, store.display().dashboard.items)

    for (const item of frame.dashboard.items)
      for (const [key, limit] of [
        ['sender', 32],
        ['subject', 64],
      ]) {
        assert.equal(item[key], mailWireText(value, limit))
        assert.ok(Buffer.byteLength(item[key]) <= limit)
        assert.ok(Buffer.byteLength(JSON.stringify(item[key])) - 2 <= limit)
        assert.doesNotMatch(item[key], /[\ud800-\udfff]/u)
      }

    assert.ok(Buffer.byteLength(text) <= 2048, `${Buffer.byteLength(text)} bytes`)
  }
})

test('mail display marks shortened text and substitutes unsupported embedded font glyphs', () => {
  assert.equal(mailWireText('Alice and José', 32), 'Alice and José')
  assert.equal(mailWireText('Thanks — €20', 32), 'Thanks — €20')
  assert.equal(mailWireText('Hi 界😀', 32), 'Hi ??')
  assert.equal(mailWireText('x'.repeat(33), 32), 'x'.repeat(29) + '\u2026')
  assert.equal(mailWireText('"'.repeat(33), 32), '"'.repeat(14) + '\u2026')
  assert.equal(mailWireText('é'.repeat(17), 32), 'é'.repeat(14) + '\u2026')

  const source = heySource([{ id: '1', sender: '😀 Alice', subject: '界'.repeat(80) }])
  const display = dashboardFor('hey', source, defaultSettings()).dashboard

  assert.equal(display.items[0].sender, '? Alice')
  assert.equal(display.items[0].subject, '?'.repeat(61) + '\u2026')
  assert.equal(source.hey.items[0].subject, '界'.repeat(80))
})
