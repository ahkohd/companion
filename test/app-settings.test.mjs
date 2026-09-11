import test from 'node:test'
import assert from 'node:assert/strict'
import { AppSettings } from '../bridge/app-settings.mjs'

test('native state requires the exact private token', () => {
  const settings = new AppSettings('private-token')

  assert.equal(settings.authorized(undefined), false)
  assert.equal(settings.authorized('wrong'), false)
  assert.equal(settings.authorized('private-token'), true)
  assert.equal(settings.snapshot().available, false)
  assert.throws(() => settings.change({ action: 'about' }))
})

test('app actions resolve only after matching native acknowledgement and actual state', async () => {
  const settings = new AppSettings('private-token')

  settings.sync({ launchAtLogin: false })
  const change = settings.change({ action: 'launchAtLogin', value: true })

  assert.throws(() => settings.change({ action: 'about' }), /Another/)

  const { command } = settings.sync({})

  assert.equal(command.action, 'launchAtLogin')
  assert.equal(command.value, true)
  assert.deepEqual(settings.sync({ result: { id: 'unrelated' } }), { command })

  settings.sync({ launchAtLogin: true, result: { id: command.id } })

  assert.equal((await change).launchAtLogin, true)
})

test('unsupported and invalid settings fail and native errors reach caller', async () => {
  const settings = new AppSettings('private-token')

  settings.sync({ updatesAvailable: false })

  assert.throws(() => settings.change({ action: 'checkForUpdates' }), /release build/)
  assert.throws(() => settings.change({ action: 'launchAtLogin', value: 'yes' }), /true or false/)
  assert.throws(() => settings.change({ action: 'shell' }), /Unknown/)

  const change = settings.change({ action: 'launchAtLogin', value: true })
  const { command } = settings.sync({})
  settings.sync({ result: { id: command.id, error: 'Permission denied' } })

  await assert.rejects(change, /Permission denied/)

  settings.updated = Date.now() - 11000

  assert.equal(settings.snapshot().available, false)
})

test('shutdown rejects pending settings and clears their timeout', async () => {
  const settings = new AppSettings('private-token')

  settings.sync({})
  const request = settings.change({ action: 'about' })
  const timer = settings.pending.timer
  settings.stop()

  await assert.rejects(request, /shutting down/)
  assert.equal(settings.pending, null)
  assert.equal(timer._destroyed, true)
  assert.equal(settings.snapshot().available, false)
  assert.throws(() => settings.change({ action: 'about' }), /Open the Companion/)
})
