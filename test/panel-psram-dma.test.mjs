import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('panel DMA integration bounds queued bounce memory and preserves BSP timing', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'panel-dma-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'esp_lcd_io_spi.h'), `#pragma once
#include <stdbool.h>
typedef int esp_err_t;
typedef int esp_lcd_spi_bus_handle_t;
typedef void *esp_lcd_panel_io_handle_t;
typedef struct {
  int pclk_hz, trans_queue_depth, command_bits;
  void *callback, *context;
  struct { unsigned quad_mode:1, psram_dma_direct:1, cs_high:1; } flags;
} esp_lcd_panel_io_spi_config_t;
`)
  await writeFile(path.join(directory, 'probe.c'), `#include "esp_lcd_io_spi.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static esp_lcd_panel_io_spi_config_t received;
static const esp_lcd_panel_io_spi_config_t *source;
static esp_lcd_panel_io_handle_t *output;
esp_err_t __wrap_esp_lcd_new_panel_io_spi(esp_lcd_spi_bus_handle_t, const esp_lcd_panel_io_spi_config_t *, esp_lcd_panel_io_handle_t *);
esp_err_t __real_esp_lcd_new_panel_io_spi(esp_lcd_spi_bus_handle_t bus, const esp_lcd_panel_io_spi_config_t *config, esp_lcd_panel_io_handle_t *io) {
  assert(bus == 2 && io == output);
  if (!config) return 7;
  assert(config != source);
  received = *config;
  return 13;
}
int main(void) {
  esp_lcd_panel_io_handle_t handle;
  output = &handle;
  esp_lcd_panel_io_spi_config_t original = { .pclk_hz = 40000000, .trans_queue_depth = 10,
    .command_bits = 32, .callback = &handle, .context = &received,
    .flags = {.quad_mode = 1, .cs_high = 1, .psram_dma_direct = 1} };
  source = &original;
  esp_lcd_panel_io_spi_config_t expected = original;
  expected.flags.psram_dma_direct = false;
  expected.trans_queue_depth = 1;
  assert(__wrap_esp_lcd_new_panel_io_spi(2, &original, &handle) == 13);
  assert(original.flags.psram_dma_direct && original.trans_queue_depth == 10);
  assert(memcmp(&received, &expected, sizeof(expected)) == 0);
  assert(__wrap_esp_lcd_new_panel_io_spi(2, 0, &handle) == 7);
  puts("DMA queue bounded; BSP configuration and driver errors preserved");
}
`)
  const executable = path.join(directory, 'probe')
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', directory,
    path.join(directory, 'probe.c'), 'firmware/main/panel_psram_dma.c', '-o', executable])
  assert.match(execFileSync(executable, [], { encoding: 'utf8' }), /DMA queue bounded/)
})
