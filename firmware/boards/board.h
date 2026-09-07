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
