import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import {
  ModuleSources,
  parseCodexBar,
  parseHeyList,
  runModuleCommand,
  HEY_LIST_FILTER,
  HEY_SCREENER_FILTER,
} from '../bridge/module-sources.mjs'

const defaults = () => ({
  usage: { enabled: false, providers: [], refreshSeconds: 60 },
  hey: { enabled: false, refreshSeconds: 60, box: 'imbox' },
})

const config = (usage = {}, hey = {}) => {
  const base = defaults()

  return { usage: { ...base.usage, ...usage }, hey: { ...base.hey, ...hey } }
}

const json = (value) => ({ stdout: JSON.stringify(value), stderr: '', code: 0 })

const usage = (provider = 'codex', usedPercent = 27) => ({
  provider,
  usage: { primary: { usedPercent, windowMinutes: 300, resetsAt: '2026-09-06T02:00:00Z' } },
})

const mail = (size = 3, seed = 1, hasMore = false) => ({
  items: Array.from({ length: size }, (_, index) => ({
    id: String(seed + index),
    sender: `Sender ${seed + index}`,
    subject: `Subject ${seed + index}`,
  })),
  hasMore,
})

const missing = () => Object.assign(new Error('spawn not found'), { code: 'ENOENT' })

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

function fixture(t, options = {}) {
  const calls = [],
    watches = []

  const runner = async (command, args, settings) => {
    calls.push({ command, args, settings })

    if (args[0] === '--version') return { stdout: `${command} 1.2.3`, stderr: '', code: 0 }

    if (args[0] === 'watch') {
      const pending = deferred()
      watches.push({ ...pending, settings })
      settings.signal.addEventListener(
        'abort',
        () => pending.reject(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' })),
        { once: true },
      )

      return pending.promise
    }

    if (options.read) return options.read(command, args, settings)

    if (command === 'codexbar') return json([usage()])

    return json(args[0] === 'box' ? mail(30, 1, true) : mail(3))
  }

  const source = new ModuleSources({ runner, ...options })
  t.after(() => source.stop())

  return {
    source,
    calls,
    watches,

    dataCalls: () =>
      calls.filter((call) => call.args[0] !== '--version' && call.args[0] !== 'watch'),
  }
}

test('CodexBar parsing keeps windows, resets and recognised plans without account details', () => {
  const result = parseCodexBar([
    {
      provider: 'codex',
      account: 'private@example.com',
      usage: {
        primary: null,
        secondary: { usedPercent: 12, resetsAt: '2026-09-10T00:00:00Z', windowMinutes: 10080 },
        extraRateWindows: [
          {
            id: 'fast',
            title: 'Fast models',
            window: { usedPercent: 37.126, resetsAt: 1790000000 },
          },
        ],
        accountEmail: 'private@example.com',
        identity: { accountEmail: 'private@example.com' },
        loginMethod: 'Pro',
      },
    },
  ])

  assert.deepEqual(result.providers[0], {
    id: 'codex',
    label: 'Codex',
    plan: 'Pro',
    windows: [
      {
        id: 'secondary',
        label: 'Weekly',
        usedPercent: 12,
        resetAt: Date.parse('2026-09-10T00:00:00Z'),
      },
      { id: 'fast', label: 'Fast models', usedPercent: 37.13, resetAt: 1790000000000 },
    ],
  })
  assert.doesNotMatch(JSON.stringify(result), /private|accountEmail|identity/)
})

test('CodexBar rejects malformed data, skips invalid windows and reports partial provider failures', () => {
  assert.throws(() => parseCodexBar('not-json'), { code: 'INVALID_OUTPUT' })
  assert.throws(() => parseCodexBar({}), { code: 'INVALID_OUTPUT' })
  assert.throws(
    () =>
      parseCodexBar([
        {
          provider: 'claude',
          error: { code: 'AUTH_REQUIRED', message: 'private@example.com must log in' },
        },
      ]),
    { code: 'AUTH_REQUIRED' },
  )
  assert.throws(
    () => parseCodexBar([{ provider: 'claude', error: { message: 'network unavailable' } }]),
    { code: 'COMMAND_FAILED' },
  )
  assert.throws(() => parseCodexBar([{ provider: 'claude', usage: [] }]), {
    code: 'INVALID_OUTPUT',
  })

  const result = parseCodexBar([
    usage('claude'),
    { provider: 'codex', error: { code: 'AUTH_REQUIRED' } },
    {
      provider: 'cursor',
      usage: {
        primary: { usedPercent: '20' },
        secondary: { usedPercent: -1 },
        tertiary: { usedPercent: 180 },
        extraRateWindows: [
          {
            id: 'unsafe@example.com',
            title: 'unsafe@example.com',
            window: { usedPercent: 5, resetsAt: 'tomorrow' },
          },
        ],
      },
    },
  ])

  assert.equal(result.providers.length, 2)
  assert.match(result.error, /Some providers/)
  assert.deepEqual(result.providers[1].windows, [
    { id: 'tertiary', label: 'Additional', usedPercent: 100, resetAt: null },
    { id: 'extra-0', label: 'Additional', usedPercent: 5, resetAt: null },
  ])
  assert.deepEqual(parseCodexBar([]).providers, [])
})

test('HEY keeps only validated sender and subject metadata with explicit pagination', () => {
  assert.deepEqual(parseHeyList(mail(0)), { items: [], hasMore: false })
  assert.deepEqual(parseHeyList(mail(30, 1, true)), mail(30, 1, true))

  const sample = {
    id: '1',
    sender: '  Alice\nExample ',
    subject: ' Update\tfor you ',
    body: 'private body',
    account: 'private account',
  }

  assert.deepEqual(parseHeyList({ items: [sample, sample], hasMore: false }), {
    items: [{ id: '1', sender: 'Alice Example', subject: 'Update for you' }],
    hasMore: false,
  })
  assert.deepEqual(
    parseHeyList({ items: [{ id: '9', sender: '', subject: '' }], hasMore: false }).items[0],
    { id: '9', sender: 'Unknown sender', subject: '(No subject)' },
  )

  const bounded = parseHeyList({
    items: [{ id: '9', sender: 'é'.repeat(121), subject: '界'.repeat(241) }],
    hasMore: true,
  })

  assert.equal([...bounded.items[0].sender].length, 120)
  assert.equal([...bounded.items[0].subject].length, 240)

  for (const value of [
    null,
    {},
    { items: [], hasMore: 'false' },
    mail(31),
    ...[
      null,
      {},
      { id: 1, sender: 'A', subject: 'B' },
      { id: '0', sender: 'A', subject: 'B' },
      { id: '1', sender: {}, subject: 'B' },
      { id: '1', sender: 'A', subject: null },
    ].map((row) => ({ items: [row], hasMore: false })),
  ]) {
    assert.throws(() => parseHeyList(value), { code: 'INVALID_OUTPUT' })
  }
})

test('startup detects installed CLIs while disabled without reading accounts or usage', async (t) => {
  const { source, calls } = fixture(t)

  await source.start()

  assert.deepEqual(
    calls.map((call) => [call.command, call.args]),
    [
      ['codexbar', ['--version']],
      ['hey', ['--version']],
    ],
  )

  for (const id of ['usage', 'hey']) {
    assert.equal(source.snapshot()[id].status, 'disabled')
    assert.equal(source.snapshot()[id].installed, true)
    assert.equal(source.snapshot()[id].refreshing, false)
    assert.equal(source.snapshot()[id].version, '1.2.3')
    assert.equal(source.snapshot()[id].updatedAt, null)
  }

  await source.refresh('hey')

  assert.equal(calls.length, 3)
  assert.deepEqual(calls[2].args, ['--version'])

  const snapshot = source.snapshot()
  snapshot.hey.items.push({ id: '1' })

  assert.deepEqual(source.snapshot().hey.items, [])
})

test('enabled usage honours configured providers, keeps partial successes and uses default selection when empty', async (t) => {
  const first = fixture(t, { settings: config({ enabled: true }) })

  await first.source.start()

  assert.equal(first.source.snapshot().usage.status, 'ready')
  assert.equal(first.dataCalls().length, 1)
  assert.equal(first.dataCalls()[0].args.includes('--provider'), false)

  const second = fixture(t, {
    settings: config({ enabled: true, providers: ['codex', 'claude'] }),

    read: (_command, args) =>
      args.at(-1) === 'claude'
        ? {
            stdout: JSON.stringify([{ provider: 'claude', error: { code: 'AUTH_REQUIRED' } }]),
            stderr: '',
            code: 1,
          }
        : json([usage()]),
  })
  await second.source.start()

  assert.equal(second.source.snapshot().usage.status, 'ready')
  assert.match(second.source.snapshot().usage.error, /Some providers/)
  assert.deepEqual(
    second.dataCalls().map((call) => call.args.at(-1)),
    ['codex', 'claude'],
  )
})

test('HEY reads a bounded selected mailbox list without fetching bodies or unrelated boxes, then watches', async (t) => {
  const { source, calls, watches, dataCalls } = fixture(t, {
    settings: config({}, { enabled: true }),
  })

  await source.start()
  const hey = source.snapshot().hey

  assert.equal(hey.status, 'ready')
  assert.equal(hey.items.length, 30)
  assert.equal(hey.hasMore, true)
  assert.equal(hey.selectedBox, 'imbox')
  assert.equal(hey.error, null)
  assert.deepEqual(
    dataCalls().map((call) => call.args),
    [['box', 'view', 'imbox', '--limit', '30', '--jq', HEY_LIST_FILTER]],
  )
  assert.equal(watches.length, 1)
  assert.equal(
    calls.some((call) => call.args.includes('--all')),
    false,
  )
  assert.equal(
    calls.some((call) =>
      call.args.some((arg) =>
        ['seen', 'thread', 'login', 'send', '--run-sync', '--run-async'].includes(arg),
      ),
    ),
    false,
  )
})

test('Screener selection lists only its sender and subject metadata', async (t) => {
  const { source, dataCalls } = fixture(t, {
    settings: config({}, { enabled: true, box: 'screener' }),
  })

  await source.start()

  assert.deepEqual(
    dataCalls().map((call) => call.args),
    [['screener', 'list', '--jq', HEY_SCREENER_FILTER]],
  )
  assert.deepEqual(source.snapshot().hey.items, mail(3).items)
  assert.equal(source.snapshot().hey.hasMore, false)
})

test('configuration validation is atomic and does not start disabled collectors', async (t) => {
  const { source, calls } = fixture(t)

  await source.start()
  const before = source.snapshot()

  for (const settings of [
    config({ providers: ['--bad'] }),
    config({ refreshSeconds: 0 }),
    config({}, { enabled: 'yes' }),
    config({}, { box: 'unknown' }),
  ]) {
    assert.throws(() => source.configure(settings))
    assert.deepEqual(source.snapshot(), before)
  }

  source.configure(config({}, { box: 'feed' }))
  await turn()

  assert.equal(calls.length, 2)
  assert.equal(source.snapshot().hey.selectedBox, 'feed')
})

test('missing executables and auth failures remain distinct and never leak command output', async (t) => {
  const absent = fixture(t, {
    settings: config({ enabled: true }),

    runner: async () => {
      throw missing()
    },
  })

  await absent.source.start()

  assert.equal(absent.source.snapshot().usage.status, 'missing')
  assert.equal(absent.source.snapshot().usage.installed, false)

  const unauthenticated = fixture(t, {
    settings: config({}, { enabled: true }),

    read: () => ({
      code: 1,
      stdout: JSON.stringify({
        ok: false,
        error: { code: 'auth_required', message: 'Log in private@example.com secret-token-123' },
      }),
      stderr: '',
    }),
  })
  await unauthenticated.source.start()
  const state = unauthenticated.source.snapshot()

  assert.equal(state.hey.status, 'auth-required')
  assert.equal(state.hey.updatedAt, null)
  assert.deepEqual(state.hey.items, [])
  assert.doesNotMatch(JSON.stringify(state), /private|secret-token/)
})

test('late usage responses cannot resurrect a disabled module even if a runner ignores abort', async (t) => {
  const pending = deferred()
  const { source, dataCalls } = fixture(t, {
    settings: config({ enabled: true }),

    read: () => pending.promise,
  })
  const starting = source.start()

  await turn()

  assert.equal(source.snapshot().usage.refreshing, true)
  assert.equal(dataCalls().length, 1)

  source.configure(config())

  assert.equal(dataCalls()[0].settings.signal.aborted, true)

  pending.resolve(json([usage()]))
  await starting

  assert.equal(source.snapshot().usage.status, 'disabled')
  assert.deepEqual(source.snapshot().usage.providers, [])
  assert.equal(source.snapshot().usage.refreshing, false)
  assert.equal(source.snapshot().usage.updatedAt, null)
})

test('manual refreshes share work and throttle reads without delaying configuration changes', async (t) => {
  let time = 100000
  const { source, dataCalls } = fixture(t, { now: () => time, settings: config({ enabled: true }) })

  await source.start()
  await source.refresh('usage')
  time += 9999
  await source.refresh('usage')

  assert.equal(dataCalls().length, 1)

  time++
  await source.refresh('usage')

  assert.equal(dataCalls().length, 2)

  source.configure(config({ enabled: true, providers: ['claude'] }))
  await turn()

  assert.equal(dataCalls().length, 3)
})

test('concurrent refreshes share one read and stopping suppresses both late responses', async (t) => {
  const pending = deferred()
  const { source, dataCalls } = fixture(t, {
    settings: config({ enabled: true }),

    read: () => pending.promise,
  })
  const starting = source.start()

  await turn()
  const refreshA = source.refresh('usage'),
    refreshB = source.refresh('usage')

  assert.equal(dataCalls().length, 1)

  source.stop()

  assert.equal(source.snapshot().usage.refreshing, false)

  pending.resolve(json([usage()]))
  await Promise.all([starting, refreshA, refreshB])

  assert.equal(source.snapshot().usage.status, 'disabled')
  assert.equal(source.snapshot().usage.updatedAt, null)
  assert.equal(source.snapshot().usage.refreshing, false)
})

test('late detection cannot change stopped state and disabled detection reports missing tools honestly', async (t) => {
  const pending = deferred()
  const { source } = fixture(t, { runner: () => pending.promise })
  const starting = source.start()

  source.stop()
  pending.resolve({ stdout: 'Tool 1.2.3', code: 0, stderr: '' })
  await starting

  assert.equal(source.snapshot().usage.installed, null)
  assert.equal(source.snapshot().hey.installed, null)

  const absent = fixture(t, {
    runner: async () => {
      throw missing()
    },
  })
  await absent.source.start()

  assert.equal(absent.source.snapshot().usage.status, 'disabled')
  assert.equal(absent.source.snapshot().usage.installed, false)
})

test('watch events coalesce into one delayed refresh and stale watchers cannot update state', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const { source, watches, dataCalls } = fixture(t, {
    settings: config({}, { enabled: true, refreshSeconds: 10 }),
  })

  await source.start()

  for (let n = 0; n < 10; n++)
    watches[0].settings.onLine(
      JSON.stringify({ change: 'updated', posting: { subject: 'private' } }),
    )

  assert.equal(dataCalls().length, 1)

  t.mock.timers.tick(9999)
  await turn()

  assert.equal(dataCalls().length, 1)

  t.mock.timers.tick(1)
  await turn()

  assert.equal(dataCalls().length, 2)

  watches[0].settings.onLine('{"change":"disconnected"}')

  assert.equal(source.snapshot().hey.status, 'error')

  source.configure(config())
  const before = source.snapshot()

  assert.equal(watches[0].settings.signal.aborted, true)

  watches[0].settings.onLine('{"change":"ready"}')
  watches[0].settings.onLine('{"change":"disconnected"}')
  t.mock.timers.tick(60000)
  await turn()

  assert.deepEqual(source.snapshot(), before)
  assert.equal(dataCalls().length, 2)
})

test('changing HEY boxes cancels the old watch and replaces the selected mailbox list', async (t) => {
  const { source, watches } = fixture(t, {
    settings: config({}, { enabled: true }),

    read: (_command, args) => json(mail(args[2] === 'feedbox' ? 7 : 2)),
  })

  await source.start()
  source.configure(config({}, { enabled: true, box: 'feed' }))
  await turn()

  assert.equal(watches[0].settings.signal.aborted, true)
  assert.equal(watches.length, 2)
  assert.equal(source.snapshot().hey.selectedBox, 'feed')
  assert.equal(source.snapshot().hey.items.length, 7)
  assert.equal(source.snapshot().hey.hasMore, false)

  source.stop()

  assert.equal(watches[1].settings.signal.aborted, true)
})

test('a transient first HEY read retries once and returns to watch-driven updates after recovery', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  let attempts = 0
  const { source, watches, dataCalls } = fixture(t, {
    settings: config({}, { enabled: true, refreshSeconds: 10 }),

    read: (_command, args) => {
      if (args[0] === 'box') {
        if (++attempts === 1) throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })

        return json(mail(7))
      }

      return { stdout: '0', stderr: '', code: 0 }
    },
  })

  await source.start()

  assert.equal(source.snapshot().hey.status, 'error')
  assert.equal(watches.length, 0)

  t.mock.timers.tick(10000)
  await turn()

  assert.equal(source.snapshot().hey.status, 'ready')
  assert.equal(source.snapshot().hey.items.length, 7)
  assert.equal(watches.length, 1)

  const reads = dataCalls().length
  t.mock.timers.tick(120000)
  await turn()

  assert.equal(dataCalls().length, reads)
})

function queuedFixture(t, id) {
  const reads = []
  let time = 1000
  const enabled = id === 'usage' ? config({ enabled: true }) : config({}, { enabled: true })
  const fixtureValue = fixture(t, {
    settings: enabled,
    minimumRefreshMs: 0,

    now: () => time,

    read: (_command, args, options) => {
      const pending = deferred()
      reads.push({ ...pending, args, options })

      return pending.promise
    },
  })

  const finishRead = async (offset, value = 27) => {
    reads[offset].resolve(id === 'usage' ? json([usage('codex', value)]) : json(mail(1, value)))
    await turn()
  }

  return {
    ...fixtureValue,
    enabled,
    reads,
    finishRead,

    setTime: (value) => {
      time = value
    },
  }
}

for (const id of ['usage', 'hey']) {
  test(`${id} keeps successful cards and timestamp during a refresh and replaces them atomically`, async (t) => {
    const { source, reads, finishRead, setTime } = queuedFixture(t, id)
    const starting = source.start()

    await turn()
    const first = source.snapshot()[id]

    assert.equal(first.status, 'loading')
    assert.equal(first.refreshing, true)
    assert.equal(first.updatedAt, null)

    if (id === 'usage') assert.deepEqual(first.providers, [])
    else assert.deepEqual(first.items, [])

    await finishRead(0)
    await starting
    const before = source.snapshot()[id]

    assert.equal(before.status, 'ready')
    assert.equal(before.refreshing, false)

    const offset = reads.length
    setTime(2000)
    const refresh = source.refresh(id),
      duplicate = source.refresh(id)

    assert.equal(reads.length, offset + 1)
    assert.deepEqual(source.snapshot()[id], { ...before, refreshing: true })

    reads[offset].resolve(id === 'hey' ? json(mail(1, 44)) : json([usage('codex', 44)]))
    await Promise.all([refresh, duplicate])
    const after = source.snapshot()[id]

    assert.equal(after.status, 'ready')
    assert.equal(after.refreshing, false)
    assert.equal(after.updatedAt, 2000)

    if (id === 'usage') assert.equal(after.providers[0].windows[0].usedPercent, 44)
    else assert.equal(after.items[0].subject, 'Subject 44')
  })

  test(`${id} refresh errors stop checking and recovery does not display cached success while pending`, async (t) => {
    const { source, reads, finishRead, setTime } = queuedFixture(t, id)
    const starting = source.start()

    await turn()
    await finishRead(0)
    await starting
    const before = source.snapshot()[id]
    setTime(2000)

    for (const [code, status] of [
      ['ETIMEDOUT', 'error'],
      ['AUTH_REQUIRED', 'auth-required'],
    ]) {
      const offset = reads.length,
        refresh = source.refresh(id)
      reads[offset].reject(Object.assign(new Error('private response details'), { code }))
      await refresh
      const failed = source.snapshot()[id]

      assert.equal(failed.status, status)
      assert.equal(failed.refreshing, false)
      assert.equal(failed.updatedAt, before.updatedAt)
      assert.doesNotMatch(failed.error, /private response/)
    }

    const offset = reads.length,
      recovery = source.refresh(id)

    assert.equal(source.snapshot()[id].status, 'loading')
    assert.equal(source.snapshot()[id].refreshing, true)

    await finishRead(offset, 55)
    await recovery

    assert.equal(source.snapshot()[id].status, 'ready')
    assert.equal(source.snapshot()[id].refreshing, false)
    assert.equal(source.snapshot()[id].updatedAt, 2000)
  })

  test(`${id} interval changes retain cards but query changes and re-enabling clear them`, async (t) => {
    const { source, reads, finishRead, enabled, setTime } = queuedFixture(t, id)
    const starting = source.start()

    await turn()
    await finishRead(0)
    await starting
    const before = source.snapshot()[id]
    setTime(2000)
    const interval = structuredClone(enabled)
    interval[id].refreshSeconds = 120
    const firstRefresh = reads.length
    source.configure(interval)

    assert.deepEqual(source.snapshot()[id], { ...before, refreshing: true })

    const firstRefreshPromise = source.refresh(id)
    const changed = structuredClone(interval)

    if (id === 'usage') changed.usage.providers = ['claude']
    else changed.hey.box = 'feed'

    source.configure(changed)

    assert.equal(reads[firstRefresh].options.signal.aborted, true)

    const newQuery = source.snapshot()[id]

    assert.equal(newQuery.status, 'loading')
    assert.equal(newQuery.refreshing, true)
    assert.equal(newQuery.updatedAt, null)

    if (id === 'usage') assert.deepEqual(newQuery.providers, [])
    else {
      assert.equal(newQuery.selectedBox, 'feed')
      assert.deepEqual(newQuery.items, [])
    }

    reads[firstRefresh].resolve(id === 'usage' ? json([usage()]) : json(mail(1, 99)))
    await firstRefreshPromise

    assert.deepEqual(source.snapshot()[id], newQuery)

    const active = reads.findLast((read) => !read.options.signal.aborted)

    if (id === 'usage') active.resolve(json([usage('claude', 41)]))
    else active.resolve(json(mail(1, 41)))

    await source.refresh(id)
    const disabled = structuredClone(changed)
    disabled[id].enabled = false
    source.configure(disabled)

    assert.equal(source.snapshot()[id].refreshing, false)
    assert.equal(source.snapshot()[id].updatedAt, null)

    source.configure(changed)

    assert.equal(source.snapshot()[id].status, 'loading')
    assert.equal(source.snapshot()[id].refreshing, true)
    assert.equal(source.snapshot()[id].updatedAt, null)

    if (id === 'usage') assert.deepEqual(source.snapshot()[id].providers, [])
    else assert.deepEqual(source.snapshot()[id].items, [])

    source.stop()

    assert.equal(source.snapshot()[id].refreshing, false)

    reads.at(-1).reject(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' }))
    await turn()

    assert.equal(source.snapshot()[id].status, 'disabled')
    assert.equal(source.snapshot()[id].refreshing, false)
  })
}

test('command runner has closed stdin, no shell expansion, bounded output and timeout cancellation', async () => {
  const result = await runModuleCommand(
    process.execPath,
    ['-e', 'process.stdout.write(process.argv[1])', '$(echo private)'],
    { timeoutMs: 2000 },
  )

  assert.equal(result.stdout, '$(echo private)')
  assert.equal(result.code, 0)
  await assert.rejects(
    runModuleCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], {
      maxOutputBytes: 100,
      timeoutMs: 2000,
    }),
    { code: 'OUTPUT_LIMIT' },
  )
  await assert.rejects(
    runModuleCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30 }),
    { code: 'ETIMEDOUT' },
  )

  const controller = new AbortController()

  controller.abort()

  await assert.rejects(runModuleCommand(process.execPath, [], { signal: controller.signal }), {
    code: 'ABORT_ERR',
  })
})

test('watch runner streams fragmented lines without keeping raw records in the result', async () => {
  const lines = []
  const result = await runModuleCommand(
    process.execPath,
    ['-e', 'process.stdout.write("first\\nsecond")'],
    { onLine: (line) => lines.push(line), timeoutMs: 2000 },
  )

  assert.deepEqual(lines, ['first', 'second'])
  assert.equal(result.stdout, '')
})
