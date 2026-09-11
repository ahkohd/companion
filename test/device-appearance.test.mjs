import test from 'node:test'
import assert from 'node:assert/strict'
import { FaceStore } from '../bridge/store.mjs'
import { defaultSettings, mergeSettings } from '../bridge/studio-settings.mjs'
import { resolveDeviceAppearance } from '../shared/device-appearance.mjs'
import { readSystemAppearance, SystemAppearance } from '../bridge/system-appearance.mjs'

test('device palettes resolve independently of dashboard and preserve geometry and accents', () => {
  const settings = defaultSettings()
  settings.appearance.theme = 'light'

  assert.equal(resolveDeviceAppearance(settings, 'light').resolved, 'dark')

  settings.deviceAppearance.mode = 'light'
  const light = resolveDeviceAppearance(settings, 'dark')

  assert.equal(light.palette.background, 0xffffff)
  assert.equal(light.design.clock.textColor, light.palette.foreground)
  assert.equal(light.design.usage.fillColor, settings.deviceAppearance.palettes.dark.accent)
  assert.equal(light.design.usage.width, settings.design.usage.width)
  assert.equal(settings.design.clock.textColor, defaultSettings().design.clock.textColor)
})

test('system changes update every module wire palette without changing saved preference', () => {
  const store = new FaceStore()

  store.setSettings(mergeSettings(store.settings, { deviceAppearance: { mode: 'system' } }))
  store.setSystemAppearance('light')

  for (const module of ['face', 'usage', 'hey', 'clock', 'roon', 'audio']) {
    store.setSettings(
      mergeSettings(store.settings, {
        modules: { [module]: { enabled: true } },
        device: { activeModule: module },
      }),
    )

    assert.equal(store.frame().theme, 'light')
    assert.equal(store.frame().palette.background, 0xffffff)
  }

  store.setSystemAppearance('dark')

  assert.equal(store.frame().theme, 'dark')
  assert.equal(store.settings.deviceAppearance.mode, 'system')
  assert.equal(store.settings.appearance.theme, 'dark')

  const seq = store.seq
  store.setSystemAppearance('dark')

  assert.equal(store.seq, seq)
})

test('palette validation rejects invalid RGB and keeps inactive palette separate', () => {
  const settings = defaultSettings()

  for (const background of [-1, 0x1000000, 1.5, '#ffffff', null])
    assert.throws(() =>
      mergeSettings(settings, { deviceAppearance: { palettes: { light: { background } } } }),
    )

  const changed = mergeSettings(settings, {
    deviceAppearance: { palettes: { light: { background: 0xfafafa } } },
  })

  assert.equal(changed.deviceAppearance.palettes.dark.background, 0)
  assert.equal(changed.deviceAppearance.palettes.light.background, 0xfafafa)
})

test('host appearance reads OS preference and retains state on query failures', async () => {
  assert.equal(
    await readSystemAppearance({ platform: 'darwin', run: async () => ({ stdout: 'Dark\n' }) }),
    'dark',
  )
  assert.equal(
    await readSystemAppearance({
      platform: 'darwin',

      run: async () => {
        throw { code: 1, stderr: 'The domain/default pair does not exist' }
      },
    }),
    'light',
  )
  assert.equal(
    await readSystemAppearance({
      platform: 'darwin',

      run: async () => {
        throw { code: 'ETIMEDOUT' }
      },
    }),
    null,
  )
  assert.equal(
    await readSystemAppearance({
      platform: 'win32',

      run: async () => ({ stdout: 'AppsUseLightTheme    REG_DWORD    0x0' }),
    }),
    'dark',
  )
  assert.equal(
    await readSystemAppearance({
      platform: 'linux',

      run: async () => ({ stdout: "'prefer-light'" }),
    }),
    'light',
  )
})

test('stopping an in-flight host appearance read prevents late updates', async () => {
  let finish
  const seen = []
  const monitor = new SystemAppearance((v) => seen.push(v), {
    read: () => new Promise((r) => (finish = r)),
  })
  const started = monitor.start()

  monitor.stop()
  finish('light')
  await started

  assert.deepEqual(seen, [])
  assert.equal(monitor.timer, undefined)
})
