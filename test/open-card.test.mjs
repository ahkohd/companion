import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import { FaceStore } from '../bridge/store.mjs'
import { DeviceLink } from '../bridge/device.mjs'
import { mergeSettings } from '../bridge/studio-settings.mjs'
import { parseHeyList } from '../bridge/module-sources.mjs'
import { heyCardURL, usageCardURL } from '../bridge/card-links.mjs'
import { openCard, resolveCardURL, launchCardURL } from '../bridge/open-card.mjs'

function fixture(module = 'hey') {
  const store = new FaceStore()
  store.setSettings(
    mergeSettings(store.settings, {
      device: { activeModule: module },
      modules: { hey: { enabled: true }, usage: { enabled: true } },
    }),
  )
  store.setSources({
    hey: {
      status: 'ready',
      selectedBox: 'imbox',
      items: Array.from({ length: 5 }, (_, i) => ({
        id: String(i + 100),
        sender: 'Sender',
        subject: 'Subject',
        url: `https://app.hey.com/topics/${i + 200}`,
      })),
    },
    usage: {
      status: 'ready',
      providers: [
        {
          id: 'codex',
          label: 'Codex',
          windows: [
            { label: 'Session', usedPercent: 10 },
            { label: 'Weekly', usedPercent: 20 },
          ],
        },
        { id: 'claude', label: 'Claude', windows: [{ label: 'Session', usedPercent: 30 }] },
      ],
    },
  })

  return store
}

const request = (store, index = 0) => ({
  module: store.activeModule,
  index,
  token: store.display().dashboard.openToken,
})

test('HEY opens supplied topic and bundle destinations, never derives topics from posting IDs', async () => {
  const parsed = parseHeyList(
    JSON.stringify({
      items: [
        { id: '12', sender: 'S', subject: 'T', url: 'https://app.hey.com/topics/900' },
        {
          id: '13',
          sender: 'S',
          subject: 'T',
          url: 'https://app.hey.com/postings/13/bundles/unseen',
        },
        { id: '14', sender: 'S', subject: 'T', url: 'https://attacker.test/topics/14' },
      ],
      hasMore: false,
    }),
  )
  const store = fixture()

  store.setSources({ hey: { status: 'ready', selectedBox: 'imbox', ...parsed } })
  const opened = []
  await openCard(store, request(store), { launch: async (url) => opened.push(url) })
  await openCard(store, request(store, 1), { launch: async (url) => opened.push(url) })

  assert.deepEqual(opened, [
    'https://app.hey.com/topics/900',
    'https://app.hey.com/postings/13/bundles/unseen',
  ])

  store.cycleHey(1)

  assert.equal(store.display().dashboard.items[0].openable, undefined)
  assert.throws(() => resolveCardURL(store, { ...request(store), token: 'a'.repeat(40) }))
})

test('card token survives checking and countdowns but rejects page, order, URL and module changes', () => {
  const store = fixture(),
    original = request(store)

  store.setSources({ hey: { ...store.sources.hey, refreshing: true, updatedAt: Date.now() } })

  assert.equal(request(store).token, original.token)
  assert.equal(resolveCardURL(store, original), 'https://app.hey.com/topics/200')

  store.cycleHey(1)

  assert.throws(() => resolveCardURL(store, original))

  store.cycleHey(-1)
  store.setSources({ hey: { ...store.sources.hey, items: [...store.sources.hey.items].reverse() } })

  assert.throws(() => resolveCardURL(store, original))

  const changed = request(store)
  store.sources.hey.items[0].url = 'https://app.hey.com/topics/999'

  assert.throws(() => resolveCardURL(store, changed))

  const fresh = request(store)
  store.setSettings(mergeSettings(store.settings, { device: { activeModule: 'usage' } }))

  assert.throws(() => resolveCardURL(store, fresh))
})

test('usage opens provider dashboard for current original slot and unknown providers stay inert', () => {
  const store = fixture('usage'),
    first = request(store)

  assert.equal(resolveCardURL(store, first), 'https://chatgpt.com/codex/settings/usage')
  assert.equal(resolveCardURL(store, request(store, 1)), resolveCardURL(store, first))

  store.sources.usage.providers[0].windows[0].usedPercent = 88

  assert.equal(request(store).token, first.token)

  store.cycleUsage(1)

  assert.equal(resolveCardURL(store, request(store)), 'https://claude.ai/settings/usage')
  assert.throws(() => resolveCardURL(store, request(store, 1)))

  store.sources.usage.providers[1].id = 'unknown-provider'

  assert.equal(store.display().dashboard.openToken, undefined)
  assert.equal(usageCardURL('unknown-provider'), null)
})

test('only allowed HTTPS destinations reach shell-free macOS launcher', async () => {
  const calls = []

  const runCommand = async (...args) => calls.push(args)

  for (const value of [
    'http://app.hey.com/topics/1',
    'https://app.hey.com.attacker.test/topics/1',
    'https://a@ app.hey.com/topics/1',
    'https://app.hey.com/topics/1?redirect=https://attacker.test',
    'file:///tmp/a',
    'javascript:alert(1)',
    'https://app.hey.com/logout',
    'https://app.hey.com/topics/1\\evil',
  ]) {
    assert.equal(heyCardURL(value), null)
    await assert.rejects(launchCardURL(value, { runCommand, platform: 'darwin' }))
  }

  await launchCardURL('https://cursor.com/dashboard?tab=usage', { runCommand, platform: 'darwin' })

  assert.deepEqual(calls, [
    [
      '/usr/bin/open',
      ['https://cursor.com/dashboard?tab=usage'],
      { timeout: 10000, maxBuffer: 4096 },
    ],
  ])
  await assert.rejects(
    launchCardURL('https://app.hey.com/topics/1', { runCommand, platform: 'linux' }),
  )
})

test('unavailable, disabled, malformed and stale requests never launch', async () => {
  const store = fixture(),
    good = request(store)
  let launches = 0

  const launch = async () => launches++

  for (const patch of [
    { index: -1 },
    { index: 3 },
    { index: 0.5 },
    { module: 'roon' },
    { token: 'x' },
    { token: null },
  ])
    await assert.rejects(openCard(store, { ...good, ...patch }, { launch }))

  store.sources.hey.status = 'error'

  await assert.rejects(openCard(store, good, { launch }))

  store.sources.hey.status = 'ready'
  store.settings.modules.hey.enabled = false

  await assert.rejects(openCard(store, good, { launch }))
  assert.equal(launches, 0)
})

test('device card events use the same resolver and reject stale buffered taps without opening', async () => {
  const store = fixture(),
    opened = []
  const link = new DeviceLink(store, {
    onOpenCard: (r) => openCard(store, r, { launch: async (url) => opened.push(url) }),
  })
  link.ready = true
  const event = { type: 'open-card', v: 1, ...request(store) }

  link.receive(JSON.stringify(event) + '\n')
  await turn()

  assert.deepEqual(opened, ['https://app.hey.com/topics/200'])

  store.cycleHey(1)
  link.receive(JSON.stringify(event) + '\n')
  await turn()

  assert.equal(opened.length, 1)
  assert.match(store.device.error, /changed/)

  for (const patch of [{ v: 2 }, { index: 3 }, { token: 'x' }, { module: 'usage' }])
    link.receive(JSON.stringify({ ...event, ...patch }) + '\n')

  await turn()

  assert.equal(opened.length, 1)
})
