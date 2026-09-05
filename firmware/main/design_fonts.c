#include "design_fonts.h"
#include "lvgl.h"
#include <math.h>

typedef struct {
    lv_font_t *runtime;
    int size;
    bool failed;
} font_slot_t;

static font_slot_t slots[DESIGN_FONT_ROLE_COUNT];
static const void *sans_data, *pixel_data;
static size_t sans_length, pixel_length;

bool design_fonts_have_error(void)
{
    for (unsigned i = 0; i < DESIGN_FONT_ROLE_COUNT; ++i) if (slots[i].failed) return true;
    return false;
}

#ifdef ESP_PLATFORM
extern const uint8_t embedded_sans_start[] asm("_binary_Geist_Regular_ttf_start");
extern const uint8_t embedded_sans_end[] asm("_binary_Geist_Regular_ttf_end");
extern const uint8_t embedded_pixel_start[] asm("_binary_GeistPixel_Circle_ttf_start");
extern const uint8_t embedded_pixel_end[] asm("_binary_GeistPixel_Circle_ttf_end");
#endif

int design_font_line(int size)
{
    return (int)lround(size * 1.22);
}

static int baseline(int size)
{
    // Match the browser's rounded Geist metrics inside its 1.22em line box.
    return (int)lround(size * .97);
}

int design_font_inset(const lv_font_t *font, int size)
{
    return baseline(size) - (font->line_height - font->base_line);
}

void design_fonts_set_data(const void *sans, size_t sans_size, const void *pixel, size_t pixel_size)
{
    // Data must outlive the UI; firmware supplies read-only embedded flash data.
    sans_data = sans; sans_length = sans_size;
    pixel_data = pixel; pixel_length = pixel_size;
}

static bool is_pixel(design_font_role_t role)
{
    return role == DESIGN_FONT_USAGE_VALUE || role == DESIGN_FONT_CLOCK_TIME;
}

static const lv_font_t *bitmap_font(design_font_role_t role, int size)
{
    if (!is_pixel(role)) {
        if (size == 16) return &lv_font_geist_16;
        if (size == 22) return &lv_font_geist_22;
        if (size == 28) return &lv_font_geist_28;
    } else {
        if (size == 44) return &lv_font_geist_pixel_44;
        if (size == 56) return &lv_font_geist_pixel_56;
        if (size == 128 && role == DESIGN_FONT_CLOCK_TIME) return &lv_font_geist_pixel_128;
    }
    return NULL;
}

const lv_font_t *design_font(design_font_role_t role, int size)
{
    if (role < 0 || role >= DESIGN_FONT_ROLE_COUNT) return &lv_font_geist_16;
    bool pixel = is_pixel(role);
    int minimum = pixel ? 24 : 12, maximum = pixel ? 160 : 48;
    if (size < minimum) size = minimum;
    if (size > maximum) size = maximum;
    const lv_font_t *bitmap = bitmap_font(role, size);
    if (bitmap) { slots[role].failed = false; return bitmap; }
#ifdef ESP_PLATFORM
    if (!sans_data) design_fonts_set_data(embedded_sans_start, embedded_sans_end - embedded_sans_start,
        embedded_pixel_start, embedded_pixel_end - embedded_pixel_start);
#endif
    font_slot_t *slot = &slots[role];
    if (!slot->runtime) {
        const void *data = pixel ? pixel_data : sans_data;
        size_t length = pixel ? pixel_length : sans_length;
        if (data && length) slot->runtime = lv_tiny_ttf_create_data_ex(data, length, size,
            LV_FONT_KERNING_NORMAL, pixel ? 16 : 32);
        if (!slot->runtime) {
            slot->failed = true;
            LV_LOG_WARN("Could not create designer font; keeping a readable fallback");
            return pixel ? &lv_font_geist_pixel_44 : &lv_font_geist_22;
        }
        slot->size = 0;
    }
    slot->failed = false;
    if (slot->size != size) {
        if (slot->size) lv_tiny_ttf_set_size(slot->runtime, size);
        slot->runtime->line_height = design_font_line(size);
        slot->runtime->base_line = design_font_line(size) - baseline(size);
        slot->size = size;
    }
    return slot->runtime;
}
