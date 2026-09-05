#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SCREEN_SIDE 466
typedef struct { int x, y, width, height; } screen_rect_t;
typedef struct { int32_t cosine, sine; } screen_transform_t;
bool screen_transform_init(unsigned rotation, screen_transform_t *transform);
bool screen_backing_update(uint16_t *backing, const uint16_t *source, screen_rect_t area);
/* Update backing and report only pixels whose values actually changed. */
bool screen_backing_update_changed(uint16_t *backing, const uint16_t *source,
                                   screen_rect_t area, screen_rect_t *changed);
/* Input and output use the byte-swapped RGB565 values sent to the panel.
 * An empty output rectangle means the dirty region lies outside the display. */
bool screen_rotate_backing(const screen_transform_t *transform, const uint16_t *backing,
                           screen_rect_t dirty, uint16_t *destination, size_t capacity,
                           screen_rect_t *rotated);
bool screen_rotate_pixels(unsigned rotation, const uint16_t *source, screen_rect_t area,
                          uint16_t *destination, size_t capacity, screen_rect_t *rotated);
void screen_unrotate_point(unsigned rotation, int x, int y, int *logical_x, int *logical_y);

#ifdef ESP_PLATFORM
#include "esp_err.h"
#include "lvgl.h"
esp_err_t screen_rotation_init(lv_display_t *display);
bool screen_rotation_apply(unsigned rotation);
unsigned screen_rotation_current(void);
unsigned screen_rotation_transfers(void);
unsigned screen_rotation_render_us(void);
unsigned screen_rotation_render_pixels(void);
unsigned screen_rotation_transfer_error(void);
unsigned screen_rotation_submitted_angle(void);
#endif
