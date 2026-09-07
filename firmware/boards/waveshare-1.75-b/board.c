#include "board.h"
#include "bsp/esp-bsp.h"

#define STRINGIFY_INNER(value) #value
#define STRINGIFY(value) STRINGIFY_INNER(value)

/* Keep the protocol additive: older hosts can still read the board ID. */
const char *companion_board_ready_json(void)
{
    return "{\"type\":\"ready\",\"v\":1,\"board\":\"" COMPANION_BOARD_ID
        "\",\"display\":{\"width\":" STRINGIFY(COMPANION_DISPLAY_WIDTH)
        ",\"height\":" STRINGIFY(COMPANION_DISPLAY_HEIGHT)
        ",\"shape\":\"" COMPANION_DISPLAY_SHAPE "\"}}\n";
}

lv_display_t *companion_board_display_start(void) { return bsp_display_start(); }
lv_indev_t *companion_board_input(void) { return bsp_display_get_input_dev(); }
esp_err_t companion_board_display_lock(uint32_t timeout_ms) { return bsp_display_lock(timeout_ms); }
void companion_board_display_unlock(void) { bsp_display_unlock(); }
esp_err_t companion_board_brightness(unsigned percent) { return bsp_display_brightness_set(percent); }
