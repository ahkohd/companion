#include "fake_rotation_runtime.h"
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "screen_rotation_runtime.c"

static const void *in_flight;
static unsigned allocations, fail_allocation, frees, draws;
static esp_lv_adapter_draw_bitmap_callbacks_t registered;
static screen_rect_t last_area;
static uint16_t pixels[SCREEN_SIDE * 50], expected[SCREEN_SIDE * SCREEN_SIDE];

void *heap_caps_aligned_alloc(size_t alignment, size_t size, unsigned caps)
{
    (void)alignment;
    (void)caps;

    return ++allocations == fail_allocation ? NULL : malloc(size);
}

void heap_caps_free(void *pointer)
{
    assert(!pointer || pointer != in_flight);

    if (pointer)
        frees++;
    free(pointer);
}

size_t heap_caps_get_free_size(unsigned caps)
{
    (void)caps;

    return 1000000;
}

size_t lv_display_get_draw_buf_size(lv_display_t *display)
{
    return display->bytes;
}

bool lv_display_flush_is_last(lv_display_t *display)
{
    return display->last;
}

esp_err_t esp_lv_adapter_set_draw_bitmap_callbacks(
    lv_display_t *display, const esp_lv_adapter_draw_bitmap_callbacks_t *callbacks, void *context)
{
    (void)display;
    (void)context;
    registered = *callbacks;

    return ESP_OK;
}

esp_err_t esp_lcd_panel_draw_bitmap(esp_lcd_panel_handle_t panel, int x1, int y1, int x2, int y2,
                                    const void *data)
{
    (void)panel;

    assert(!in_flight);

    draws++;
    in_flight = data;
    last_area = (screen_rect_t){x1, y1, x2 - x1, y2 - y1};

    return ESP_OK;
}

static esp_err_t flush(lv_display_t *display, screen_rect_t area, bool last)
{
    in_flight = NULL; /* LVGL's previous-flush wait has completed. */
    display->last = last;

    return registered.custom_draw_bitmap(display, NULL, area.x, area.y, area.x + area.width,
                                         area.y + area.height, pixels, NULL);
}

static void reset(void)
{
    in_flight = NULL;
    heap_caps_free(scratch);
    heap_caps_free(pending_scratch);
    heap_caps_free(backing);
    scratch = pending_scratch = backing = NULL;
    scratch_pixels = pending_pixels = 0;
    current_rotation = 0;
    force_full = false;
    failed_rotation = UINT_MAX;
    buffered_dirty = (screen_rect_t){0};
    allocations = fail_allocation = draws = frees = 0;
}

int main(void)
{
    lv_display_t display = {.bytes = sizeof(pixels)};

    assert(screen_rotation_init(&display) == ESP_OK);

    for (int y = 0; y < SCREEN_SIDE; y += 50) {
        int height = SCREEN_SIDE - y < 50 ? SCREEN_SIDE - y : 50;

        for (int row = 0; row < height; ++row)
            for (int x = 0; x < SCREEN_SIDE; ++x)
                pixels[row * SCREEN_SIDE + x] = (uint16_t)((y + row) * 467 + x);

        assert(flush(&display, (screen_rect_t){0, y, SCREEN_SIDE, height},
                     y + height == SCREEN_SIDE) == ESP_OK);
    }

    assert(draws == 10 && backing[SCREEN_SIDE * SCREEN_SIDE - 1] == (uint16_t)(465 * 467 + 465));
    assert(screen_rotation_apply(90));
    assert(flush(&display, (screen_rect_t){100, 100, 10, 10}, true) == ESP_OK);

    const void *old_scratch = scratch;
    unsigned old_frees = frees;

    assert(in_flight == old_scratch && screen_rotation_apply(37));
    assert(scratch == old_scratch && pending_scratch && frees == old_frees);

    unsigned before = draws;

    assert(flush(&display, (screen_rect_t){100, 100, 10, 10}, false) == ESP_ERR_NOT_ALLOWED);
    assert(frees == old_frees + 1 && !pending_scratch && draws == before);
    assert(flush(&display, (screen_rect_t){120, 110, 10, 10}, true) == ESP_OK);
    assert(draws == before + 1 && last_area.width == SCREEN_SIDE &&
           last_area.height == SCREEN_SIDE);

    screen_rect_t expected_area;

    assert(screen_rotate_backing(&transform, backing,
                                 (screen_rect_t){0, 0, SCREEN_SIDE, SCREEN_SIDE}, expected,
                                 SCREEN_SIDE * SCREEN_SIDE, &expected_area));
    assert(memcmp(&last_area, &expected_area, sizeof(last_area)) == 0);
    assert(memcmp(in_flight, expected, last_area.width * last_area.height * sizeof(uint16_t)) == 0);

    before = draws;

    for (int y = 0; y < SCREEN_SIDE; y += 50) {
        int height = SCREEN_SIDE - y < 50 ? SCREEN_SIDE - y : 50;
        bool last = y + height == SCREEN_SIDE;

        assert(flush(&display, (screen_rect_t){0, y, SCREEN_SIDE, height}, last) ==
               (last ? ESP_OK : ESP_ERR_NOT_ALLOWED));
    }

    assert(draws == before + 1 && last_area.width == SCREEN_SIDE &&
           last_area.height == SCREEN_SIDE);

    /* Identical invalidations produce no transfer. One changed pixel produces
     * only its bilinear footprint, even inside a large invalidation. */
    before = draws;
    memcpy(pixels, backing, sizeof(pixels));

    assert(flush(&display, (screen_rect_t){0, 0, SCREEN_SIDE, 50}, true) == ESP_ERR_NOT_ALLOWED);
    assert(draws == before);

    pixels[20 * SCREEN_SIDE + 233] ^= 0xffff;

    assert(flush(&display, (screen_rect_t){0, 0, SCREEN_SIDE, 50}, true) == ESP_OK);
    assert(draws == before + 1 && last_area.width * last_area.height <= 100);
    assert(screen_rotation_apply(45));

    /* Changing the angle must repaint even when logical content is unchanged. */
    assert(flush(&display, (screen_rect_t){464, 0, 2, 2}, true) == ESP_OK);

    before = draws;

    assert(flush(&display, (screen_rect_t){464, 0, 2, 2}, true) == ESP_ERR_NOT_ALLOWED &&
           draws == before);

    reset();

    assert(screen_rotation_init(&display) == ESP_OK);

    fail_allocation = allocations + 1;

    assert(!screen_rotation_apply(37) && screen_rotation_current() == 0);
    assert(screen_rotation_apply(90));
    assert(flush(&display, (screen_rect_t){20, 20, 2, 2}, true) == ESP_OK);

    fail_allocation = allocations + 1;

    assert(!screen_rotation_apply(38) && screen_rotation_current() == 90 && in_flight == scratch);
    assert(screen_rotation_apply(0));

    fail_allocation = 0;

    assert(screen_rotation_apply(37));

    reset();

    fail_allocation = 2; /* Missing startup backing preserves cardinal rotation. */

    assert(screen_rotation_init(&display) == ESP_OK && !backing);
    assert(!screen_rotation_apply(1) && screen_rotation_current() == 0);
    assert(screen_rotation_apply(90));
    assert(flush(&display, (screen_rect_t){20, 20, 2, 2}, true) == ESP_OK);

    reset();
    fail_allocation = 1; /* Missing transfer memory still allows normal startup. */

    assert(screen_rotation_init(&display) == ESP_OK && !scratch);
    assert(!screen_rotation_apply(90) && screen_rotation_current() == 0);
    assert(flush(&display, (screen_rect_t){20, 20, 2, 2}, true) == ESP_OK);

    reset();
    puts(
        "PASS: coalesced partial/full flushes, offscreen completion, deferred DMA buffer replacement and graceful allocation failures");
}
