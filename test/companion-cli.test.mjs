import test from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../scripts/companion.mjs'

test('CLI wait returns only recorded results and distinguishes timeout from approval', async () => {
  const output = []

  const fetcher = async () => ({
    ok: true,

    json: async () => ({ attention: { active: { id: 'a' }, queue: [], history: [] } }),
  })

  assert.equal(
    await run(['wait', '--id', 'a', '--timeout', '0'], {
      fetcher,

      out: (item) => output.push(item),
    }),
    2,
  )
  assert.deepEqual(output[0], { id: 'a', status: 'timeout', approved: false })
  assert.equal(
    await run(['wait', '--id', 'missing'], { fetcher, out: (item) => output.push(item) }),
    2,
  )
  assert.equal(output[1].status, 'unavailable')

  const result = { id: 'a', outcome: 'responded', action: 'cancel' }

  assert.equal(
    await run(['wait', '--id', 'a'], {
      out: (item) => output.push(item),

      fetcher: async () => ({ ok: true, json: async () => ({ attention: { history: [result] } }) }),
    }),
    0,
  )
  assert.deepEqual(output[2], result)
})

test('CLI mutations require ownership and send JSON without shell interpretation', async () => {
  await assert.rejects(run(['clear', '--id', 'a']), /owner/)

  let sent

  await run(['clear', '--id', 'a', '--owner', 'agent-1'], {
    out: () => {},

    fetcher: async (url, options) => {
      sent = { url: String(url), body: JSON.parse(options.body) }

      return { ok: true, json: async () => ({ attention: {}, attentionResult: { id: 'a' } }) }
    },
  })

  assert.equal(new URL(sent.url).pathname, '/api/attention/clear')
  assert.deepEqual(sent.body, { id: 'a', owner: 'agent-1' })
})

test('CLI notification, decision and chain work against an isolated bridge', {
  timeout: 15000,
}, async (t) => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { spawn, execFile } = await import('node:child_process')
  const { once } = await import('node:events')
  const { promisify } = await import('node:util')
  const { defaultSettings } = await import('../bridge/studio-settings.mjs')
  const dir = await mkdtemp(path.join(tmpdir(), 'attention-cli-'))
  const settings = defaultSettings()
  settings.device.followMouse = false
  settings.device.activeModule = 'clock'

  for (const [id, module] of Object.entries(settings.modules)) module.enabled = id === 'clock'

  await writeFile(path.join(dir, 'studio.json'), JSON.stringify(settings))
  const env = {
    ...process.env,
    PORT: '0',
    ESP_SERIAL_PORT: '',
    STUDIO_SETTINGS_PATH: path.join(dir, 'studio.json'),
    DISPLAY_SETTINGS_PATH: path.join(dir, 'display.json'),
    ROON_PAIRING_PATH: path.join(dir, 'roon.json'),
  }
  const bridge = spawn(process.execPath, ['bridge/server.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(async () => {
    if (bridge.exitCode === null) {
      const ended = once(bridge, 'exit')
      bridge.kill('SIGTERM')
      await ended
    }

    await rm(dir, { recursive: true, force: true })
  })
  const [output] = await once(bridge.stdout, 'data')
  env.COMPANION_URL = output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)[0]
  const execute = promisify(execFile)

  const cli = async (...args) => {
    try {
      const result = await execute(process.execPath, ['scripts/companion.mjs', ...args], { env })

      return { code: 0, result: JSON.parse(result.stdout) }
    } catch (error) {
      if (error.stdout) return { code: error.code, result: JSON.parse(error.stdout) }

      throw error
    }
  }

  const show = async (request) => {
    await writeFile(path.join(dir, 'request.json'), JSON.stringify(request))

    return (await cli('show', '--json', path.join(dir, 'request.json'))).result
  }

  // Synthetic taps are restricted to this disposable test bridge, never the live device.
  const tap = async (id, action) => {
    const state = await (await fetch(env.COMPANION_URL + '/api/state')).json()
    const result = await fetch(
      env.COMPANION_URL + '/api/attention/' + (action === 'open' ? 'details' : 'act'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          revision: state.attention.active.revision,
          ...(action === 'open' ? { detail: true } : { action }),
        }),
      },
    )

    assert.equal(result.status, 200)

    return result.json()
  }

  const notice = await show({ owner: 'test', title: 'Tests passed', durationMs: 1000 })
  const expired = await cli('wait', '--id', notice.id, '--timeout', '3')

  assert.equal(expired.result.outcome, 'expired')
  assert.equal(expired.result.action, null)

  const decision = await show({ owner: 'test', kind: 'decision', title: 'Synthetic decision' })
  const timeout = await cli('wait', '--id', decision.id, '--timeout', '0')

  assert.equal(timeout.code, 2)
  assert.equal(timeout.result.approved, false)
  assert.equal((await cli('status')).result.active.id, decision.id)

  await tap(decision.id, 'open')
  await tap(decision.id, 'decline')
  const cancelled = await cli('wait', '--id', decision.id)

  assert.equal(cancelled.result.outcome, 'dismissed')
  assert.equal(cancelled.result.action, 'decline')

  const chain = await show({
    owner: 'test',
    kind: 'decision',
    steps: [
      { title: 'Step one', actions: [{ id: 'next', label: 'Next', kind: 'next' }] },
      { title: 'Step two', actions: [{ id: 'finish', label: 'Finish', kind: 'respond' }] },
    ],
  })
  await tap(chain.id, 'open')
  const advanced = await tap(chain.id, 'next')

  assert.equal(advanced.attention.active.title, 'Step two')

  await tap(chain.id, 'open')
  await tap(chain.id, 'finish')
  const finished = await cli('wait', '--id', chain.id)

  assert.equal(finished.result.outcome, 'responded')
  assert.equal(finished.result.action, 'finish')
})
