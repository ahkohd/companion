import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('ordinary allocations prefer PSRAM to preserve internal memory for display DMA', () => {
  const config = readFileSync('firmware/sdkconfig.defaults', 'utf8')

  assert.match(config, /^CONFIG_SPIRAM_USE_MALLOC=y$/m)
  assert.match(config, /^CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=0$/m)
})
