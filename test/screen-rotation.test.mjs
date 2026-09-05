import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('screen rotation preserves partial updates, filters arbitrary angles and inversely maps touch', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'screen-rotation-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = path.join(directory, 'probe')
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', 'firmware/main',
    'test/screen-rotation-probe.c', 'firmware/main/screen_rotation.c', 'firmware/main/module_touch.c', '-lm', '-o', executable])
  assert.match(execFileSync(executable, [], { encoding: 'utf8' }), /868624 complete-frame pixel\/touch mappings,2000 arbitrary partial rectangles/)
})

test('rotation runtime batches refreshes and preserves DMA memory across allocation failures', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rotation-runtime-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const header = `#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
static inline int64_t esp_timer_get_time(void) { return 0; }
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_INVALID_SIZE 1
#define ESP_ERR_NOT_ALLOWED 2
#define MALLOC_CAP_SPIRAM 1
#define MALLOC_CAP_8BIT 2
#define ESP_LOGW(tag, ...) ((void)(tag))
#define ESP_LOGI(tag, ...) ((void)(tag))
typedef struct {size_t bytes; bool last;} lv_display_t;
typedef void *esp_lcd_panel_handle_t;
typedef struct {esp_err_t (*custom_draw_bitmap)(lv_display_t *, esp_lcd_panel_handle_t, int, int, int, int, const void *, void *);} esp_lv_adapter_draw_bitmap_callbacks_t;
void *heap_caps_aligned_alloc(size_t, size_t, unsigned);
void heap_caps_free(void *);
size_t heap_caps_get_free_size(unsigned);
size_t lv_display_get_draw_buf_size(lv_display_t *);
bool lv_display_flush_is_last(lv_display_t *);
esp_err_t esp_lv_adapter_set_draw_bitmap_callbacks(lv_display_t *, const esp_lv_adapter_draw_bitmap_callbacks_t *, void *);
esp_err_t esp_lcd_panel_draw_bitmap(esp_lcd_panel_handle_t, int, int, int, int, const void *);
`
  await writeFile(path.join(directory, 'fake_rotation_runtime.h'), header)
  await Promise.all(['esp_err.h', 'lvgl.h', 'esp_heap_caps.h', 'esp_lcd_panel_ops.h', 'esp_lv_adapter_display.h', 'esp_log.h', 'esp_timer.h']
    .map(name => writeFile(path.join(directory, name), '#include "fake_rotation_runtime.h"\n')))
  const executable = path.join(directory, 'runtime')
  execFileSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DESP_PLATFORM', '-I', directory,
    '-I', 'firmware/main', 'test/screen-rotation-runtime-probe.c', 'firmware/main/screen_rotation.c', '-lm', '-o', executable])
  assert.match(execFileSync(executable, [], { encoding: 'utf8' }), /coalesced partial\/full flushes/)
})
