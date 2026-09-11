import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { HerdrClient, defaultSocket } from '../bridge/herdr.mjs'

test('socket configuration honours explicit overrides', () => {
  assert.equal(defaultSocket({ HERDR_SOCKET_PATH: '/a', HERDR_API_SOCKET: '/b' }), '/a')
  assert.equal(defaultSocket({ HERDR_CONFIG_PATH: '/custom/config.toml' }), '/custom/herdr.sock')
})

test('fragmented responses, event refresh, new subscriptions and reconnect', {
  timeout: 6000,
}, async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hf-'))
  const socketPath = path.join(directory, 'test.sock')
  let agents = [{ pane_id: 'a', agent: 'pi', agent_status: 'working' }]
  let peer
  const subscriptions = []
  const peers = new Set()
  const server = net.createServer((socket) => {
    peers.add(socket)
    socket.on('close', () => peers.delete(socket))
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk
      let end

      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)

        if (message.method === 'events.subscribe') {
          peer = socket
          subscriptions.push(message.params.subscriptions)
        }

        const response =
          JSON.stringify({
            id: message.id,
            result: message.method === 'agent.list' ? { agents } : { subscriptions: [] },
          }) + '\n'
        socket.write(response.slice(0, 7))
        setImmediate(() => {
          if (!socket.destroyed) {
            socket.write(response.slice(7))

            if (message.method !== 'events.subscribe') socket.end()
          }
        })
      }
    })
  })

  server.listen(socketPath)
  await once(server, 'listening')
  const client = new HerdrClient({ socketPath, refreshMs: 10000, timeoutMs: 500 })
  t.after(async () => {
    client.stop()

    for (const p of peers) p.destroy()

    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  })
  let next = once(client, 'agents')
  client.start()

  assert.equal((await next)[0][0].agent_status, 'working')

  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.ok(
    subscriptions[0].some((s) => s.type === 'pane.agent_status_changed' && s.pane_id === 'a'),
  )

  agents = [...agents, { pane_id: 'b', agent: 'pi', agent_status: 'blocked' }]
  next = once(client, 'agents')
  peer.write('{"event":"pane.created","data":{"pane_id":"b"}}\n')

  assert.equal((await next)[0].length, 2)

  await new Promise((resolve) => setTimeout(resolve, 30))

  assert.ok(subscriptions.at(-1).some((s) => s.pane_id === 'b'))

  peer.destroy()
  await new Promise((resolve) => setTimeout(resolve, 20))
  next = once(client, 'agents')
  client.refresh()

  assert.equal((await next)[0].length, 2)
})
