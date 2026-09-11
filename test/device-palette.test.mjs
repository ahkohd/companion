import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('native semantic palette retains accents and themes face coverage', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'device-palette-'))

  try {
    const cjson = '.tools/esp-idf/components/json/cJSON'
    const binary = path.join(dir, 'probe')
    execFileSync('cc', [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-Ifirmware/main',
      `-I${cjson}`,
      'test/device-palette-probe.c',
      'firmware/main/display_module.c',
      'firmware/main/face_model.c',
      `${cjson}/cJSON.c`,
      '-lm',
      '-o',
      binary,
    ])

    assert.match(execFileSync(binary, { encoding: 'utf8' }), /palette and raster checks passed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
