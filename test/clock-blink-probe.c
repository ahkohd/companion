#include "module_view.c"
#include <stdlib.h>

static uint16_t screen_pixels[466 * 466], visible_pixels[466 * 466];

static void flush(lv_display_t *display, const lv_area_t *area, uint8_t *data)
{
    int width = lv_area_get_width(area);

    for (int y = area->y1; y <= area->y2; ++y)
        memcpy(screen_pixels + y * 466 + area->x1, data + (y - area->y1) * width * 2, width * 2);
    lv_display_flush_ready(display);
}

static void *read_font(const char *path, size_t *size)
{
    FILE *file = fopen(path, "rb");

    assert(file);
    assert(fseek(file, 0, SEEK_END) == 0);

    *size = ftell(file);
    rewind(file);
    void *data = malloc(*size);

    assert(data && fread(data, 1, *size, file) == *size);

    fclose(file);

    return data;
}

static void save(const char *name)
{
    char path[256];
    snprintf(path, sizeof(path), ".work/clock-blink-%s.ppm", name);
    FILE *file = fopen(path, "wb");

    assert(file);

    fprintf(file, "P6\n466 466\n255\n");

    for (unsigned i = 0; i < 466 * 466; ++i) {
        unsigned p = screen_pixels[i];
        unsigned char rgb[3] = {((p >> 11) & 31) * 255 / 31, ((p >> 5) & 63) * 255 / 63,
                                (p & 31) * 255 / 31};
        fwrite(rgb, 1, 3, file);
    }

    fclose(file);
}

int main(void)
{
    lv_init();
    size_t sans_size, pixel_size;
    void *sans = read_font("fonts/geist/Geist-Regular.ttf", &sans_size),
         *pixel = read_font("fonts/geist/GeistPixel-Circle.ttf", &pixel_size);
    design_fonts_set_data(sans, sans_size, pixel, pixel_size);
    lv_display_t *display = lv_display_create(466, 466);
    static uint16_t buffer[466 * 466];
    lv_display_set_buffers(display, buffer, NULL, sizeof(buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_flush_cb(display, flush);
    lv_obj_t *screen = lv_screen_active();
    lv_obj_remove_style_all(screen);
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    module_view_create(screen);
    module_snapshot_t module = {.kind = DISPLAY_CLOCK,
                                .count = 5,
                                .status = MODULE_READY,
                                .blink_separator = true,
                                .has_design = true,
                                .weekday = "Wed"};
    module_design_default(DISPLAY_CLOCK, &module.design);
    const char *times[] = {"5:20", "12:59", "00:00"};
    unsigned cases = 0, blinking = 0;

    for (int size = 24; size <= 160; ++size)
        for (int align = 0; align < 3; ++align)
            for (int narrow = 0; narrow < 2; ++narrow)
                for (unsigned time = 0; time < 3; ++time) {
                    module.design.clock.timeSize = size;
                    module.design.clock.align = align;
                    module.design.clock.width = narrow ? 180 : 400;
                    strcpy(module.time, times[time]);
                    module_view_update(&module, false);
                    module_view_tick(.499999);
                    lv_refr_now(display);
                    memcpy(visible_pixels, screen_pixels, sizeof(visible_pixels));
                    lv_point_t colon;
                    lv_label_get_letter_pos(
                        clock_time, (uint32_t)(strchr(module.time, ':') - module.time), &colon);
                    int left = lv_obj_get_x(clock_time) + colon.x;
                    const lv_font_t *font = lv_obj_get_style_text_font(clock_time, 0);
                    int width = lv_font_get_glyph_width(font, ':', strchr(module.time, ':')[1]);
                    bool colon_fits =
                        strchr(lv_label_get_text(clock_time), ':') && colon.y == 0 &&
                        left >= lv_obj_get_x(clock_time) &&
                        left + width <= lv_obj_get_x(clock_time) + lv_obj_get_width(clock_time);
                    if (size == 128 && align == 1 && !narrow && time == 0)
                        save("visible");
                    module_view_tick(.5);
                    lv_refr_now(display);
                    unsigned changes = 0;

                    for (unsigned i = 0; i < 466 * 466; ++i)
                        if (screen_pixels[i] != visible_pixels[i]) {
                            int x = i % 466;
                            if (!(x >= left - 1 && x < left + width + 1 && screen_pixels[i] == 0)) {
                                fprintf(
                                    stderr,
                                    "Unexpected pixel shift: size=%d align=%d width=%d time=%s x=%d colon=%d..%d old=%u new=%u\n",
                                    size, align, module.design.clock.width, module.time, x, left,
                                    left + width, visible_pixels[i], screen_pixels[i]);
                                fprintf(stderr, "Visible text=%s Hidden label=%s\n", module.time,
                                        lv_label_get_text(clock_time));
                                save("failure-hidden");
                                memcpy(screen_pixels, visible_pixels, sizeof(screen_pixels));
                                save("failure-visible");
                                abort();
                            }

                            changes++;
                        }

                    if (changes)
                        blinking++;
                    if (colon_fits)
                        assert(changes > 0);

                    if (size == 128 && align == 1 && !narrow && time == 0)
                        save("hidden");
                    module_view_tick(1.0);
                    lv_refr_now(display);

                    assert(memcmp(visible_pixels, screen_pixels, sizeof(visible_pixels)) == 0);

                    cases++;
                }

    assert(blinking > 0);

    module.design.clock.width = 400;
    module.design.clock.timeSize = 128;
    module.design.clock.align = 1;
    strcpy(module.time, "5:20");
    module_view_update(&module, false);
    module_view_tick(.5);
    lv_refr_now(display);
    module.blink_separator = false;
    module_view_update(&module, false);
    module_view_tick(.75);
    lv_refr_now(display);
    memcpy(visible_pixels, screen_pixels, sizeof(visible_pixels));

    for (unsigned i = 0; i < 20; ++i) {
        module_view_tick(i * .125);
        lv_refr_now(display);

        assert(!memcmp(visible_pixels, screen_pixels, sizeof(visible_pixels)));
    }

    module.blink_separator = true;
    module_view_update(&module, false);
    module_view_tick(.75);
    lv_refr_now(display);

    assert(memcmp(visible_pixels, screen_pixels, sizeof(visible_pixels)) != 0);

    strcpy(module.time, "12:59");
    module_view_update(&module, false);
    module_view_tick(.75);
    lv_refr_now(display);

    assert(lv_label_get_text_selection_start(clock_time) == 2);

    module_view_update(&module, true);
    module_view_tick(.75);
    lv_refr_now(display);

    assert(lv_obj_has_flag(clock_view, LV_OBJ_FLAG_HIDDEN));
    assert(!clock_blink_active && !design_fonts_have_error());

    printf(
        "PASS: %u size/alignment/width/time cases preserve every non-colon pixel across blink transitions; %u visible colons blink; setting changes and disconnect are correct\n",
        cases, blinking);
}
