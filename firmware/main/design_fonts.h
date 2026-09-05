#pragma once
#include "fonts/geist.h"
#include <stddef.h>

typedef enum {
    DESIGN_FONT_FACE_TITLE, DESIGN_FONT_FACE_NAME,
    DESIGN_FONT_USAGE_PROVIDER, DESIGN_FONT_USAGE_RESET, DESIGN_FONT_USAGE_VALUE,
    DESIGN_FONT_HEY_SENDER, DESIGN_FONT_HEY_SUBJECT,
    DESIGN_FONT_CLOCK_TIME, DESIGN_FONT_CLOCK_DAY,
    DESIGN_FONT_ROON_TITLE, DESIGN_FONT_ROON_ARTIST,
    DESIGN_FONT_ROLE_COUNT
} design_font_role_t;

// Each role owns one stable runtime handle; resizing never evicts another label's font.
const lv_font_t *design_font(design_font_role_t role, int size);
int design_font_line(int size);
int design_font_inset(const lv_font_t *font, int size);
void design_fonts_set_data(const void *sans, size_t sans_length, const void *pixel, size_t pixel_length);
bool design_fonts_have_error(void);

static inline lv_text_align_t design_text_align(int align)
{
    return align == 0 ? LV_TEXT_ALIGN_LEFT : align == 2 ? LV_TEXT_ALIGN_RIGHT : LV_TEXT_ALIGN_CENTER;
}
