#include "screen_rotation.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lv_adapter_display.h"
#include "esp_log.h"
#include "esp_timer.h"
#include <limits.h>
#include <stdatomic.h>
#include <string.h>

static _Atomic unsigned submitted_transfers, transfer_error, submitted_rotation, render_us, render_pixels;
unsigned screen_rotation_render_us(void) { return atomic_load(&render_us); }
unsigned screen_rotation_render_pixels(void) { return atomic_load(&render_pixels); }
unsigned screen_rotation_transfers(void) { return atomic_load(&submitted_transfers); }
unsigned screen_rotation_transfer_error(void) { return atomic_load(&transfer_error); }
unsigned screen_rotation_submitted_angle(void) { return atomic_load(&submitted_rotation); }

static uint16_t *scratch;
static size_t scratch_pixels;
static uint16_t *pending_scratch, *backing;
static size_t pending_pixels;
static unsigned current_rotation;
static unsigned failed_rotation = UINT_MAX;
static screen_transform_t transform;
static screen_rect_t buffered_dirty;
static bool force_full;
static const char *TAG = "screen_rotation";

static esp_err_t submit_pixels(esp_lcd_panel_handle_t panel, int x1, int y1, int x2, int y2, const void *pixels)
{
    esp_err_t result = esp_lcd_panel_draw_bitmap(panel, x1, y1, x2, y2, pixels);
    atomic_store(&transfer_error, (unsigned)result);
    if (result == ESP_OK) {
        atomic_store(&submitted_rotation, current_rotation);
        atomic_fetch_add(&submitted_transfers, 1);
    }
    return result;
}

static esp_err_t rotated_draw(lv_display_t *display, esp_lcd_panel_handle_t panel,
                              int x1, int y1, int x2, int y2, const void *pixels, void *context)
{
    (void)display; (void)context;
    /* This hook runs only after LVGL waits for the preceding DMA transfer. */
    if (pending_scratch) {
        heap_caps_free(scratch);
        scratch = pending_scratch; scratch_pixels = pending_pixels;
        pending_scratch = NULL; pending_pixels = 0;
    }
    screen_rect_t dirty = {x1, y1, x2 - x1, y2 - y1};
    if (current_rotation % 90) {
        if (!screen_backing_update_changed(backing, pixels, dirty, &dirty)) return ESP_ERR_INVALID_SIZE;
    } else if (backing && !screen_backing_update(backing, pixels, dirty)) return ESP_ERR_INVALID_SIZE;
    if (!current_rotation) return submit_pixels(panel, x1, y1, x2, y2, pixels);
    screen_rect_t area;
    if (current_rotation % 90) {
        /* LVGL splits a full refresh into roughly ten strips. Sampling each
         * rotated strip separately would repeatedly draw their overlap. Keep
         * the logical updates and send their union once, on the final flush. */
        x1 = dirty.x; y1 = dirty.y; x2 = x1 + dirty.width; y2 = y1 + dirty.height;
        if (!buffered_dirty.width) buffered_dirty = dirty;
        else if (dirty.width) {
            int right = buffered_dirty.x + buffered_dirty.width, bottom = buffered_dirty.y + buffered_dirty.height;
            if (x2 > right) right = x2;
            if (y2 > bottom) bottom = y2;
            if (x1 < buffered_dirty.x) buffered_dirty.x = x1;
            if (y1 < buffered_dirty.y) buffered_dirty.y = y1;
            buffered_dirty.width = right - buffered_dirty.x;
            buffered_dirty.height = bottom - buffered_dirty.y;
        }
        if (!lv_display_flush_is_last(display)) return ESP_ERR_NOT_ALLOWED;
        dirty = buffered_dirty; buffered_dirty = (screen_rect_t){0};
        if (force_full) dirty = (screen_rect_t){0, 0, SCREEN_SIDE, SCREEN_SIDE};
        if (!dirty.width) return ESP_ERR_NOT_ALLOWED;
        force_full = false;
        int64_t started = esp_timer_get_time();
        if (!screen_rotate_backing(&transform, backing, dirty, scratch, scratch_pixels, &area)) return ESP_ERR_INVALID_SIZE;
        atomic_store(&render_us, (unsigned)(esp_timer_get_time() - started));
        atomic_store(&render_pixels, (unsigned)(area.width * area.height));
        /* The adapter explicitly treats NOT_ALLOWED as a skipped blit and
         * completes its flush handshake without waiting for a panel ISR. */
        if (!area.width || !area.height) return ESP_ERR_NOT_ALLOWED;
    } else if (!screen_rotate_pixels(current_rotation, pixels, dirty, scratch, scratch_pixels, &area)) return ESP_ERR_INVALID_SIZE;
    /* LVGL waits for the previous flush before invoking this hook. Its existing
     * color-complete callback releases this scratch buffer for the next flush. */
    esp_err_t result = submit_pixels(panel, area.x, area.y, area.x + area.width, area.y + area.height, scratch);
    if (result != ESP_OK && current_rotation % 90) force_full = true;
    return result;
}

esp_err_t screen_rotation_init(lv_display_t *display)
{
    size_t bytes = lv_display_get_draw_buf_size(display);
    if (!bytes || bytes > SCREEN_SIDE * SCREEN_SIDE * sizeof(uint16_t) || bytes % sizeof(uint16_t)) return ESP_ERR_INVALID_SIZE;
    scratch = heap_caps_aligned_alloc(64, (bytes + 63) & ~(size_t)63, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    scratch_pixels = scratch ? bytes / sizeof(uint16_t) : 0;
    size_t frame_bytes = SCREEN_SIDE * SCREEN_SIDE * sizeof(uint16_t);
    backing = heap_caps_aligned_alloc(64, (frame_bytes + 63) & ~(size_t)63, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (backing) memset(backing, 0, frame_bytes);
    else ESP_LOGW(TAG, "No logical backing buffer; arbitrary rotation unavailable");
    if (!scratch) ESP_LOGW(TAG, "No rotation transfer buffer; keeping display upright");
    const esp_lv_adapter_draw_bitmap_callbacks_t callbacks = { .custom_draw_bitmap = rotated_draw };
    esp_err_t result = esp_lv_adapter_set_draw_bitmap_callbacks(display, &callbacks, NULL);
    if (result != ESP_OK) {
        heap_caps_free(scratch); heap_caps_free(backing);
        scratch = backing = NULL; scratch_pixels = 0;
    }
    return result;
}

bool screen_rotation_apply(unsigned rotation)
{
    if (rotation > 359 || rotation == current_rotation || rotation == failed_rotation) return false;
    if (rotation && !scratch) {
        failed_rotation = rotation;
        ESP_LOGW(TAG, "Cannot apply %u degrees: no transfer buffer", rotation);
        return false;
    }
    if (rotation % 90) {
        size_t required = SCREEN_SIDE * SCREEN_SIDE;
        if (!backing) {
            failed_rotation = rotation;
            ESP_LOGW(TAG, "Cannot apply %u degrees: no logical backing", rotation);
            return false;
        }
        if (scratch_pixels < required && pending_pixels < required) {
            size_t bytes = required * sizeof(uint16_t);
            pending_scratch = heap_caps_aligned_alloc(64, (bytes + 63) & ~(size_t)63, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
            if (!pending_scratch) {
                failed_rotation = rotation;
                ESP_LOGW(TAG, "Cannot apply %u degrees: insufficient rotation memory", rotation);
                return false;
            }
            pending_pixels = required;
            ESP_LOGI(TAG, "Arbitrary rotation ready: %u bytes backing and output, %u bytes free PSRAM",
                (unsigned)(bytes * 2), (unsigned)heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
        }
        screen_transform_init(rotation, &transform);
    }
    /* Called by the LVGL task between frames. Never rewrite an in-flight buffer
     * or change panel MADCTL: its validated crop stays at the BSP's default. */
    current_rotation = rotation;
    atomic_store(&render_us, 0); atomic_store(&render_pixels, 0);
    force_full = rotation % 90 != 0;
    buffered_dirty = (screen_rect_t){0};
    failed_rotation = UINT_MAX;
    return true;
}

unsigned screen_rotation_current(void) { return current_rotation; }
