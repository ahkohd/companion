#include "lvgl.h"
#include "design_fonts.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *read_font(const char *path, size_t *size)
{
    FILE *file = fopen(path, "rb"); assert(file);
    assert(fseek(file, 0, SEEK_END) == 0); *size = ftell(file); rewind(file);
    void *data = malloc(*size); assert(data && fread(data, 1, *size, file) == *size); fclose(file); return data;
}
static uint16_t screen_pixels[466 * 466];
static void flush(lv_display_t *display, const lv_area_t *area, uint8_t *pixels)
{
    int width = lv_area_get_width(area);
    for (int y = area->y1; y <= area->y2; ++y)
        memcpy(screen_pixels + y * 466 + area->x1, pixels + (y - area->y1) * width * 2, width * 2);
    lv_display_flush_ready(display);
}
static void save(const char *prefix, unsigned role, int size)
{
    char path[1024]; snprintf(path, sizeof(path), "%s-%u-%d.ppm", prefix, role, size);
    FILE *file = fopen(path, "wb"); assert(file); fprintf(file, "P6\n466 466\n255\n");
    for (unsigned i = 0; i < 466 * 466; ++i) {
        unsigned p = screen_pixels[i]; unsigned char rgb[3] = {((p >> 11) & 31) * 255 / 31, ((p >> 5) & 63) * 255 / 63, (p & 31) * 255 / 31};
        fwrite(rgb, 1, 3, file);
    }
    fclose(file);
}
int main(int argc, char **argv)
{
    lv_init();
    lv_display_t *display = lv_display_create(466, 466);
    static uint16_t buffer[466 * 466];
    lv_display_set_buffers(display, buffer, NULL, sizeof(buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565); lv_display_set_flush_cb(display, flush);
    lv_obj_remove_style_all(lv_screen_active()); lv_obj_set_style_bg_opa(lv_screen_active(), LV_OPA_COVER, 0);
    assert(design_font(DESIGN_FONT_FACE_TITLE, 31) != NULL);
    assert(design_fonts_have_error());
    size_t sans_size, pixel_size;
    void *sans = read_font("fonts/geist/Geist-Regular.ttf", &sans_size);
    void *pixel = read_font("fonts/geist/GeistPixel-Circle.ttf", &pixel_size);
    design_fonts_set_data(sans, sans_size, pixel, pixel_size);
    const lv_font_t *title = design_font(DESIGN_FONT_FACE_TITLE, 31);
    assert(title->line_height == design_font_line(31)); assert(!design_fonts_have_error());
    lv_font_glyph_dsc_t source_pi;
    assert(lv_font_get_glyph_dsc(title, &source_pi, 0x3c0, 0));
    assert(!source_pi.is_placeholder && source_pi.box_w > 0 && source_pi.box_h > 0);
    puts("PASS: source Geist TTF contains a real pi glyph");
    const lv_font_t *subject = design_font(DESIGN_FONT_HEY_SUBJECT, 19);
    assert(title != subject);
    lv_obj_t *label = lv_label_create(lv_screen_active()); lv_obj_set_size(label, 416, 220); lv_obj_set_pos(label, 25, 100);
    lv_obj_set_style_text_color(label, lv_color_white(), 0); lv_obj_set_style_bg_color(lv_screen_active(), lv_color_black(), 0);
    unsigned cases = 0;
    for (unsigned role = 0; role < DESIGN_FONT_ROLE_COUNT; ++role) {
        bool pixel_role = role == DESIGN_FONT_USAGE_VALUE || role == DESIGN_FONT_CLOCK_TIME;
        const lv_font_t *runtime = NULL;
        for (int size = pixel_role ? 24 : 12; size <= (pixel_role ? 160 : 48); ++size) {
            const lv_font_t *font = design_font(role, size); assert(font);
            int baseline = (int)(size * .97 + .5);
            assert(font->line_height - font->base_line + design_font_inset(font, size) == baseline);
            bool bitmap = pixel_role ? size == 44 || size == 56 || (size == 128 && role == DESIGN_FONT_CLOCK_TIME) : size == 16 || size == 22 || size == 28;
            if (!bitmap) { if (runtime) assert(runtime == font); else runtime = font; assert(font->line_height == design_font_line(size)); }
            const char *text = pixel_role ? role == DESIGN_FONT_USAGE_VALUE ? "100%." : "12:59." : "Hello, world!";
            for (const char *p = text; *p; ++p) {
                lv_font_glyph_dsc_t glyph; assert(lv_font_get_glyph_dsc(font, &glyph, *p, p[1])); assert(!glyph.is_placeholder);
            }
            if (!pixel_role) {
                lv_font_glyph_dsc_t pi;
                assert(lv_font_get_glyph_dsc(font, &pi, 0x3c0, 0));
                assert(!pi.is_placeholder && pi.box_w > 0 && pi.box_h > 0);
            }
            lv_obj_set_style_text_font(label, font, 0);
            lv_label_set_text(label, pixel_role ? text : "Session \xcf\x80 - fixing the playground");
            lv_obj_invalidate(label);
            lv_refr_now(display);
            unsigned ink = 0; for (unsigned i = 0; i < 466 * 466; ++i) if (screen_pixels[i]) ++ink;
            assert(ink > 0);
            if (argc > 1 && ((role == DESIGN_FONT_FACE_NAME && (size == 16 || size == 19)) ||
                (role == DESIGN_FONT_HEY_SENDER && size == 31) || (role == DESIGN_FONT_CLOCK_TIME && size == 113))) save(argv[1], role, size);
            cases++;
        }
        assert(!design_fonts_have_error());
    }
    const lv_font_t *a = design_font(DESIGN_FONT_HEY_SENDER, 31);
    const lv_font_t *b = design_font(DESIGN_FONT_HEY_SUBJECT, 19);
    for (int repeat = 0; repeat < 50; ++repeat) {
        assert(design_font(DESIGN_FONT_CLOCK_TIME, 113 + repeat % 2));
        assert(design_font(DESIGN_FONT_FACE_NAME, 33 + repeat % 2));
        assert(a->line_height == design_font_line(31)); assert(b->line_height == design_font_line(19));
    }
    assert(design_font(DESIGN_FONT_USAGE_VALUE, 128) != &lv_font_geist_pixel_128);
    assert(design_font(DESIGN_FONT_FACE_TITLE, 16) == &lv_font_geist_16);
    assert(design_font(DESIGN_FONT_USAGE_VALUE, 44) == &lv_font_geist_pixel_44);
    assert(design_font_inset(&lv_font_geist_pixel_44, 44) == 10);
    assert(design_font_inset(&lv_font_geist_pixel_56, 56) == 13);
    assert(design_font_inset(&lv_font_geist_pixel_128, 128) == 32);
    printf("PASS: %u role/size combinations rasterized; pi available at every Sans size; stable isolated handles, exact metrics and allocation-failure reporting\n", cases);
    // Font data intentionally remains alive as long as the cached font handles.
    return 0;
}
