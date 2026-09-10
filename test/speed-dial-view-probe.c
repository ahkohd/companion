#include "module_view.c"
#include <stdlib.h>

static uint16_t screen_pixels[466 * 466], before_press[466 * 466], atlas[160 * 160];
static void flush(lv_display_t *display, const lv_area_t *area, uint8_t *data)
{
    int width = lv_area_get_width(area);
    for (int y = area->y1; y <= area->y2; ++y)
        memcpy(screen_pixels + y * 466 + area->x1, data + (y - area->y1) * width * 2, width * 2);
    lv_display_flush_ready(display);
}
static void *read_font(const char *path, size_t *size)
{
    FILE *file = fopen(path, "rb"); assert(file);
    assert(!fseek(file, 0, SEEK_END)); *size = ftell(file); rewind(file);
    void *data = malloc(*size); assert(data && fread(data, 1, *size, file) == *size); fclose(file); return data;
}
static void save(const char *path, bool rectangular)
{
    FILE *file = fopen(path, "wb"); assert(file); fprintf(file, "P6\n466 466\n255\n");
    for (unsigned i = 0; i < 466 * 466; ++i) {
        unsigned p = screen_pixels[i]; int x = i % 466 - 233, y = i / 466 - 233;
        unsigned char rgb[3] = {((p >> 11) & 31) * 255 / 31, ((p >> 5) & 63) * 255 / 63, (p & 31) * 255 / 31};
        if (!rectangular && x * x + y * y > 233 * 233) memset(rgb, 24, sizeof(rgb));
        fwrite(rgb, 1, 3, file);
    }
    fclose(file);
}
int main(void)
{
    lv_init(); size_t sans_size, pixel_size;
    void *sans = read_font("fonts/geist/Geist-Regular.ttf", &sans_size), *pixel = read_font("fonts/geist/GeistPixel-Circle.ttf", &pixel_size);
    design_fonts_set_data(sans, sans_size, pixel, pixel_size);
    lv_display_t *display = lv_display_create(466, 466); static uint16_t buffer[466 * 466];
    lv_display_set_buffers(display, buffer, NULL, sizeof(buffer), LV_DISPLAY_RENDER_MODE_FULL);
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565); lv_display_set_flush_cb(display, flush);
    lv_obj_t *screen = lv_screen_active(); lv_obj_remove_style_all(screen);
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0); lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    module_view_create(screen);
    module_snapshot_t module = {.kind = DISPLAY_SPEED_DIAL, .count = 7, .show_navigation = true, .status = MODULE_READY, .page_count = 2,
        .speed_dial = {.grid_size = 0, .list_rows = 4, .show_labels = true, .rectangular = true, .count = 9},
        .palette = {0, 0xf2edfa, 0x958ca4, 0x151515, 0x2b2b2b, 0x65c18c, 0x65c18c, 0xd9be81, 0xe88483}};
    memset(module.open_token, 'a', 40); memset(module.art_id, 'b', 40);
    for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) {
        module.speed_dial.buttons[i].enabled = true;
        module.speed_dial.buttons[i].icon_index = i;
        snprintf(module.speed_dial.buttons[i].id, sizeof(module.speed_dial.buttons[i].id), "button-%u", i);
        snprintf(module.speed_dial.buttons[i].label, sizeof(module.speed_dial.buttons[i].label), "Button %u", i + 1);
        unsigned offset = speed_dial_icon_offset(i) / 2;
        for (unsigned y = 0; y < 32; ++y) for (unsigned x = 0; x < 32; ++x)
            atlas[offset + y * 160 + x] = (uint16_t)((i + 1) * 0x0765);
    }
    for (unsigned labels = 0; labels < 2; ++labels) {
        module.speed_dial.show_labels = labels;
        module_view_update(&module, false); lv_refr_now(display);
        speed_dial_geometry_t geometry; assert(speed_dial_geometry(&module, 0, &geometry));
        speed_dial_target_t unavailable = {0};
        int x = geometry.button.x + geometry.button.width / 2, y = geometry.button.y + geometry.button.height / 2;
        assert(!module_view_speed_dial_press(x, y, &unavailable));
        assert(!module_view_speed_dial_press_valid(x, y, &unavailable));
        for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) assert(!lv_obj_is_visible(speed_dial_images[i]));
    }
    module_view_set_artwork("cccccccccccccccccccccccccccccccccccccccc", (uint8_t *)atlas);
    module_view_update(&module, false);
    speed_dial_geometry_t unavailable_geometry; assert(speed_dial_geometry(&module, 0, &unavailable_geometry));
    speed_dial_target_t unavailable = {0};
    assert(!module_view_speed_dial_press(unavailable_geometry.button.x + unavailable_geometry.button.width / 2,
        unavailable_geometry.button.y + unavailable_geometry.button.height / 2, &unavailable));
    module_view_set_artwork(module.art_id, (uint8_t *)atlas);
    module_view_update(&module, false); lv_refr_now(display);
    for (unsigned i = 0; i < module.speed_dial.count; ++i) {
        assert(!lv_obj_has_flag(speed_dial_images[i], LV_OBJ_FLAG_HIDDEN));
        speed_dial_geometry_t g; assert(speed_dial_geometry(&module, i, &g));
        assert(g.icon.width == 48);
        for (unsigned y = 8; y < 40; ++y) for (unsigned x = 8; x < 40; ++x)
            assert(screen_pixels[(g.icon.y + y) * 466 + g.icon.x + x] == (uint16_t)((i + 1) * 0x0765));
    }
    save(".work/speed-dial-square-native.ppm", true);
    module.speed_dial.rectangular = false;
    module.speed_dial.count = speed_dial_layout(&module, NULL);
    assert(module.speed_dial.count == 7);
    module_view_update(&module, false); lv_refr_now(display);
    assert(!lv_obj_is_visible(speed_dial_panels[7]) && !lv_obj_is_visible(speed_dial_panels[8]));
    lv_area_t footer_bounds; lv_obj_get_coords(speed_dial_footer, &footer_bounds);
    for (unsigned i = 0; i < 7; ++i) {
        lv_area_t dot_bounds; lv_obj_get_coords(dots[i], &dot_bounds);
        assert(dot_bounds.y1 == 446 && dot_bounds.y1 > footer_bounds.y2);
    }
    save(".work/speed-dial-grid-native.ppm", false);
    module.speed_dial.show_labels = false;
    module.speed_dial.count = speed_dial_layout(&module, NULL);
    assert(module.speed_dial.count == 13);
    lv_point_t page_size;
    lv_text_get_size(&page_size, "1 / 2", &lv_font_geist_mono_16, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    assert(page_size.x <= 56 && page_size.y <= 22);
    for (unsigned count = 1; count <= SPEED_DIAL_BUTTON_LIMIT; ++count) {
        module.speed_dial.count = count;
        module_view_update(&module, false); lv_refr_now(display);
        for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) {
            assert(lv_obj_is_visible(speed_dial_images[i]) == (i < count));
            if (i >= count) continue;
            speed_dial_geometry_t slot; assert(speed_dial_geometry(&module, i, &slot));
            int px = slot.icon.x + slot.icon.width / 2, py = slot.icon.y + slot.icon.height / 2;
            assert(screen_pixels[py * 466 + px] == (uint16_t)((i + 1) * 0x0765));
        }
        if (count == 9) save(".work/speed-dial-nine-native.ppm", false);
    }
    save(".work/speed-dial-edge-native.ppm", false);
    module.page_count = 1; module_view_update(&module, false); lv_refr_now(display);
    assert(!lv_obj_is_visible(speed_dial_footer));
    speed_dial_geometry_t centred; assert(speed_dial_geometry(&module, 0, &centred));
    assert(2 * centred.button.x + centred.button.width == 466);
    assert(2 * centred.button.y + centred.button.height == 466);
    save(".work/speed-dial-centred-native.ppm", false);
    speed_dial_target_t centred_target;
    assert(module_view_speed_dial_press(233, 233, &centred_target));
    module.page_count = 2; module_view_update(&module, false); lv_refr_now(display);
    assert(lv_obj_is_visible(speed_dial_footer));
    assert(!module_view_speed_dial_press_valid(233, 233, &centred_target));
    speed_dial_geometry_t g; assert(speed_dial_geometry(&module, 0, &g));
    int x = g.button.x + g.button.width / 2, y = g.button.y + g.button.height / 2;
    speed_dial_target_t target;
    memcpy(before_press, screen_pixels, sizeof(before_press));
    assert(module_view_speed_dial_press(x, y, &target)); lv_refr_now(display);
    assert(memcmp(before_press, screen_pixels, sizeof(before_press)));
    assert(module_view_speed_dial_press_valid(x, y, &target));
    module_view_set_artwork(NULL, NULL);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    assert(!module_view_speed_dial_press(x, y, &target));
    module_view_set_artwork(module.art_id, (uint8_t *)atlas);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    assert(module_view_speed_dial_press(x, y, &target));
    module_view_set_artwork("cccccccccccccccccccccccccccccccccccccccc", (uint8_t *)atlas);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    module_view_set_artwork(module.art_id, (uint8_t *)atlas);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    assert(module_view_speed_dial_press(x, y, &target));
    module.page_index = 1; module_view_update(&module, false);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    module.page_index = 0; module_view_update(&module, false);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    assert(module_view_speed_dial_press(x, y, &target));
    module_view_update(&module, true);
    assert(!module_view_speed_dial_press_valid(x, y, &target));
    module.art_id[0] = 'c'; module_view_update(&module, false); lv_refr_now(display);
    for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) assert(!lv_obj_is_visible(speed_dial_images[i]));
    module.art_id[0] = 'b'; module.speed_dial.list = true;
    display_module_design(&module, &module.design); module.has_design = true; module.design.speedDial.labelSize = 26;
    for (unsigned i = 0; i < 4; ++i) { module.speed_dial.buttons[i].status = i; module.speed_dial.buttons[i].has_color = true; module.speed_dial.buttons[i].color = 0xff0000; }
    for (unsigned light = 0; light < 2; ++light) for (unsigned rows = 3; rows <= 4; ++rows) {
        module.palette.background = light ? 0xffffff : 0;
        module.design.speedDial.textColor = light ? 0 : 0xffffff;
        lv_obj_set_style_bg_color(screen, lv_color_hex(module.palette.background), 0);
        module.speed_dial.count = module.speed_dial.list_rows = rows;
        module_view_update(&module, false); module_view_tick(.4); lv_refr_now(display);
        for (unsigned i = 0; i < rows; ++i) {
            speed_dial_geometry_t slot; assert(speed_dial_geometry(&module, i, &slot));
            assert(lv_obj_get_style_bg_opa(speed_dial_panels[i], 0) == LV_OPA_TRANSP);
            assert(lv_obj_get_style_text_font(speed_dial_labels[i], 0) == design_font(DESIGN_FONT_SPEED_DIAL_LABEL, 26));
            int px = slot.button.x + 8, py = slot.button.y + slot.button.height / 2;
            assert(screen_pixels[py * 466 + px] == (light ? 0xffff : 0));
            speed_dial_target_t list_target;
            bool hittable = module.speed_dial.buttons[i].status != SPEED_DIAL_RUNNING;
            assert(speed_dial_target_at(&module, px, py, &list_target) == hittable);
            if (hittable) assert(!strcmp(list_target.id, module.speed_dial.buttons[i].id));
        }
        save(light ? ".work/speed-dial-list-light-native.ppm" : ".work/speed-dial-list-native.ppm", false);
    }
    module.speed_dial.list = false; module.speed_dial.count = speed_dial_layout(&module, NULL);
    module_view_update(&module, false);
    for (unsigned i = 0; i < module.speed_dial.count; ++i) assert(lv_obj_get_style_bg_opa(speed_dial_panels[i], 0) == LV_OPA_COVER);
    module.speed_dial.grid_size = 5;
    module_view_update(&module, false);
    for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) assert(!lv_obj_is_visible(speed_dial_panels[i]));
    assert(!module_view_speed_dial_press(x, y, &target));
    assert(!design_fonts_have_error());
    puts("Native LVGL atlas stride, pixels, identity, pressed feedback and stale-touch checks passed");
}
