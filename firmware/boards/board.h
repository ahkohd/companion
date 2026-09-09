#pragma once

#include <stdint.h>
#include "esp_err.h"
#include "lvgl.h"
#include "board_config.h"

/* Each selected board implements the hardware boundary. */
lv_display_t *companion_board_display_start(void);
lv_indev_t *companion_board_input(void);
esp_err_t companion_board_display_lock(uint32_t timeout_ms);
void companion_board_display_unlock(void);
esp_err_t companion_board_brightness(unsigned percent);
const char *companion_board_ready_json(void);

/* Metadata for the physical sample currently replayed by the LVGL read callback.
 * Revision changes invalidate a contact after lost samples or hardware read errors. */
int64_t companion_board_touch_sample_time_us(void);
uint32_t companion_board_touch_revision(void);
bool companion_board_touch_sample_valid(void);
void companion_board_touch_cancel(void);
uint32_t companion_board_touch_reads(void);
uint32_t companion_board_touch_errors(void);
