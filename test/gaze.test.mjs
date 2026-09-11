import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'

test('gaze remains finite when resuming animation after direct mouse updates', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: 'web/vendor/bloub/engine.ts', formats: ['es'] },
    },
  })
  const bundle = Array.isArray(result) ? result[0] : result
  const code = bundle.output.find((item) => item.type === 'chunk' && item.isEntry).code
  const { BotEngine } = await import(
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  )
  const engine = new BotEngine(100, 'idle')
  const point = { yaw: -20, pitch: 15, mix: 1, spin: 0, wander: 0 }
  // Reduced motion freezes the clock while successive pointer updates arrive.

  engine.setLook(point, 1, 0)
  engine.setLook({ ...point, yaw: 20 }, 1, 0)
  engine.setLook({ ...point, pitch: -15 }, 1, 0.18)

  for (const elapsed of [0, 0.016, 0.08, 0.17, 0.2]) {
    const frame = engine.sample(1 + elapsed)

    assert.ok(frame.eyes.length > 0)

    for (const eye of frame.eyes)
      assert.doesNotMatch(eye.matrix + eye.d, /NaN|Infinity/, `elapsed=${elapsed}`)
  }
})
