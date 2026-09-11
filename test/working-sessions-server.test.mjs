import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import os from 'node:os'
import path from 'node:path'

test('server streams rotating working sessions without attached hardware', {
  timeout: 12000,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'working-session-http-'))
  const socketPath = path.join(directory, 'herdr.sock'),
    peers = new Set()
  const herdr = net.createServer((socket) => {
    peers.add(socket)
    socket.on('close', () => peers.delete(socket))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk

      if (!buffer.includes('\n')) return

      const request = JSON.parse(buffer.trim())
      const result =
        request.method === 'agent.list'
          ? {
              agents: ['Alpha', 'Beta'].map((name) => ({
                pane_id: name,
                name,
                agent: 'pi',
                agent_status: 'working',
              })),
            }
          : { type: 'subscribed' }
      socket.write(JSON.stringify({ id: request.id, result }) + '\n')

      if (request.method !== 'events.subscribe') socket.end()
    })
  })

  herdr.listen(socketPath)
  await once(herdr, 'listening')

  for (const cli of ['codexbar', 'hey'])
    await writeFile(path.join(directory, cli), `#!${process.execPath}\nconsole.log('1.0.0');\n`, {
      mode: 0o700,
    })

  const child = spawn(process.execPath, ['bridge/server.mjs'], {
    env: {
      ...process.env,
      PATH: directory + path.delimiter + process.env.PATH,
      PORT: '0',
      ESP_SERIAL_PORT: '',
      HERDR_SOCKET_PATH: socketPath,
      STUDIO_SETTINGS_PATH: path.join(directory, 'studio.json'),
      DISPLAY_SETTINGS_PATH: path.join(directory, 'display.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stderr.on('data', (chunk) => {
    logs += chunk
  })
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }

    for (const socket of peers) socket.destroy()

    await new Promise((resolve) => herdr.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  const [output] = await once(child.stdout, 'data')
  const base = output.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]

  assert.ok(base, logs)

  const stream = await fetch(base + '/api/events', { signal: AbortSignal.timeout(9000) })
  const reader = stream.body.getReader(),
    decoder = new TextDecoder()
  let buffer = '',
    initial

  while (true) {
    const chunk = await reader.read()

    assert.equal(chunk.done, false)

    buffer += decoder.decode(chunk.value, { stream: true })
    let end

    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)

      if (!event.startsWith('data: ')) continue

      const snapshot = JSON.parse(event.slice(6))

      if (!initial && snapshot.display.name === 'Alpha') initial = snapshot

      if (snapshot.display.name !== 'Beta') continue

      assert.ok(initial)
      assert.equal(snapshot.display.label, '2 Working')
      assert.equal(snapshot.display.nameShimmer, true)
      assert.equal(snapshot.changedAt, initial.changedAt)
      assert.equal(snapshot.selected, 'all')

      await reader.cancel()

      return
    }
  }
})
