#include "module_view.h"
#include "device_palette.h"
#include "fonts/geist.h"
#include "design_fonts.h"
#include "face_shimmer.h"
#include "roon_artwork.h"
#include "usage_pattern.h"
#include "roon_motion.h"
#include "music_badge_icons.h"
#include "module_touch.h"
#include "reicon_icons.h"
#include "src/misc/cache/instance/lv_image_cache.h"
#ifdef ESP_PLATFORM
#include "esp_heap_caps.h"
#endif
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

#define COLOR_TEXT 0xf2edfa
#define COLOR_MUTED 0x958ca4
#define COLOR_ACCENT 0xb4a2ed
#define COLOR_TRACK 0x2b2534
#define MAIL_ROWS MODULE_MESSAGE_LIMIT
#define CHECKING_WIDTH 120
#define CHECKING_HEIGHT 20

static lv_obj_t *speed_dial_view, *speed_dial_footer;
static lv_obj_t *speed_dial_panels[SPEED_DIAL_BUTTON_LIMIT], *speed_dial_images[SPEED_DIAL_BUTTON_LIMIT], *speed_dial_labels[SPEED_DIAL_BUTTON_LIMIT], *speed_dial_badges[SPEED_DIAL_BUTTON_LIMIT];
static lv_image_dsc_t speed_dial_sources[SPEED_DIAL_BUTTON_LIMIT];
static module_snapshot_t speed_dial_shown;
static speed_dial_target_t speed_dial_pressed;
static bool speed_dial_active;
static int speed_dial_pressed_index = -1, speed_dial_pressed_x, speed_dial_pressed_y;
static lv_obj_t *audio_picker, *audio_picker_footer, *audio_rows[3], *audio_names[3], *audio_checks[3];
static lv_obj_t *audio_view, *audio_title, *audio_value, *audio_device, *audio_controls[3];
static bool audio_enabled[3], audio_muted, audio_input;
static uint32_t audio_text_color;
static lv_obj_t *body, *usage, *mail, *empty, *clock_view, *roon;
static display_module_t open_module;
static char open_token[41];
static bool open_cards[MODULE_MESSAGE_LIMIT];
static lv_obj_t *usage_panels[2], *bar_fills[2], *values[2], *providers[2], *pills[2], *captions[2], *resets[2];
static lv_obj_t *bar_tracks[2];
static lv_obj_t *bar_patterns[2];
static uint32_t *bar_pattern_pixels[2];
static lv_obj_t *mail_panels[MAIL_ROWS];
static lv_obj_t *mail_senders[MAIL_ROWS], *mail_subjects[MAIL_ROWS];
static lv_obj_t *empty_title, *empty_detail, *dots[MODULE_LIMIT];
static lv_obj_t *clock_time, *clock_weekday;
static bool clock_blink_active, clock_separator_visible = true;
static lv_obj_t *music_source_badge, *music_like_badge;
static music_player_t music_player;
static bool music_can_like, music_liked;
static lv_obj_t *roon_art, *roon_image, *roon_placeholder, *roon_title, *roon_artist, *roon_controls[3], *roon_chrome;
static uint8_t *roon_pixels;
static char roon_art_id[ROON_ART_ID_CAPACITY];
static lv_image_dsc_t roon_image_source;
static bool roon_playing, roon_previous, roon_next;
static uint32_t roon_text_color;
static lv_opa_t roon_chrome_opacity = LV_OPA_COVER;
static bool roon_render_active;
static double module_animation_time;
static roon_motion_t roon_motion;
static lv_obj_t *checking_canvas;
static bool checking_active;
static device_palette_t current_palette;
_Alignas(4) static uint16_t checking_mask[CHECKING_WIDTH * CHECKING_HEIGHT];
_Alignas(4) static uint16_t checking_pixels[CHECKING_WIDTH * CHECKING_HEIGHT];

static void passive(lv_obj_t *object)
{
    lv_obj_remove_flag(object, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
}

static lv_obj_t *group(lv_obj_t *parent)
{
    lv_obj_t *object = lv_obj_create(parent);
    lv_obj_remove_style_all(object);
    lv_obj_set_size(object, 466, 466);
    passive(object);
    return object;
}

static lv_obj_t *label(lv_obj_t *parent, int x, int y, int width, const lv_font_t *font, uint32_t color, lv_text_align_t align)
{
    lv_obj_t *object = lv_label_create(parent);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_size(object, width, font->line_height);
    lv_label_set_long_mode(object, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_font(object, font, 0);
    lv_obj_set_style_text_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_text_align(object, align, 0);
    lv_label_set_text(object, "");
    passive(object);
    return object;
}

static void show(lv_obj_t *object, bool visible)
{
    if (visible) lv_obj_remove_flag(object, LV_OBJ_FLAG_HIDDEN);
    else lv_obj_add_flag(object, LV_OBJ_FLAG_HIDDEN);
}

static lv_obj_t *rounded(lv_obj_t *parent, int x, int y, int width, int height, int radius, uint32_t color)
{
    lv_obj_t *object = lv_obj_create(parent);
    lv_obj_remove_style_all(object);
    lv_obj_set_pos(object, x, y);
    lv_obj_set_size(object, width, height);
    lv_obj_set_style_bg_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(object, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(object, radius, 0);
    passive(object);
    return object;
}

static void fit_pill(lv_obj_t *pill, lv_obj_t *caption, const char *text, const usage_design_t *design)
{
    lv_point_t size;
    lv_text_get_size(&size, text, &lv_font_geist_16, 0, 0, LV_COORD_MAX, LV_TEXT_FLAG_NONE);
    int inner = design->width - design->padding * 2;
    int maximum = inner / 2 + 9;
    if (maximum > 163) maximum = 163;
    int width = size.x + design->pillPadding * 2;
    if (width > maximum) width = maximum;
    int right = design->width - design->padding;
    lv_obj_set_pos(pill, right - width, design->pillY);
    lv_obj_set_width(pill, width);
    lv_obj_set_height(pill, design->pillHeight);
    lv_obj_set_style_radius(pill, design->pillHeight / 2, 0);
    lv_obj_set_pos(caption, right - width + design->pillPadding,
        design->pillY + (design->pillHeight - lv_font_geist_16.line_height) / 2);
    lv_obj_set_width(caption, width - design->pillPadding * 2);
    lv_obj_set_style_text_color(caption, lv_color_hex(design->textColor), 0);
    lv_label_set_text(caption, text);
}

static void usage_card(unsigned index, int y)
{
    lv_obj_t *panel = rounded(usage, 63, y, 340, 150, 16, 0x151515);
    usage_panels[index] = panel;
    lv_obj_add_flag(panel, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    providers[index] = label(panel, 16, 14, 308, &lv_font_geist_16, COLOR_MUTED, LV_TEXT_ALIGN_LEFT);
    /* The pixel numeric subset needs 12 px to match the browser's 54 px line box. */
    values[index] = label(panel, 16, 46, 138, &lv_font_geist_pixel_44, COLOR_TEXT, LV_TEXT_ALIGN_LEFT);
    pills[index] = rounded(panel, 161, 48, 163, 30, 15, 0x292929);
    captions[index] = label(panel, 175, 53, 135, &lv_font_geist_16, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
    lv_obj_t *track = rounded(panel, 16, 96, 308, 10, 5, 0x2b2b2b);
    bar_tracks[index] = track;
    bar_fills[index] = rounded(track, 0, 0, 308, 10, 5, 0x65c18c);
    show(bar_fills[index], false);
    bar_patterns[index] = lv_canvas_create(panel);
    passive(bar_patterns[index]); show(bar_patterns[index], false);
    resets[index] = label(panel, 16, 116, 308, &lv_font_geist_16, COLOR_MUTED, LV_TEXT_ALIGN_LEFT);
}

static void mail_card(unsigned index)
{
    lv_obj_t *panel = rounded(mail, 63, 85 + (int)index * 148, 340, 136, 16, 0x151515);
    mail_panels[index] = panel;
    lv_obj_add_flag(panel, LV_OBJ_FLAG_OVERFLOW_VISIBLE);
    mail_senders[index] = label(panel, 16, 12, 308, &lv_font_geist_28, COLOR_TEXT, LV_TEXT_ALIGN_LEFT);
    mail_subjects[index] = label(panel, 16, 56, 308, &lv_font_geist_28, COLOR_MUTED, LV_TEXT_ALIGN_LEFT);
    lv_obj_set_height(mail_subjects[index], 68);
    lv_obj_set_style_text_line_space(mail_subjects[index], 0, 0);
}

static void audio_check_icon(lv_event_t *event)
{
    lv_area_t bounds; lv_obj_get_coords(lv_event_get_target_obj(event), &bounds);
    lv_draw_image_dsc_t image; lv_draw_image_dsc_init(&image);
    image.src = &music_audio_check; image.recolor = lv_color_hex(current_palette.foreground); image.recolor_opa = LV_OPA_COVER;
    image.scale_x = image.scale_y = 64; image.antialias = true; image.pivot.x = image.pivot.y = 0;
    lv_area_t area = {bounds.x1, bounds.y1, bounds.x1 + 95, bounds.y1 + 95};
    lv_draw_image(lv_event_get_layer(event), &image, &area);
}

bool module_view_audio_open_hit(int x, int y)
{
    lv_obj_t *targets[] = {audio_title, audio_value, audio_device};
    for (unsigned i = 0; i < 3; ++i) {
        lv_area_t area; lv_obj_get_coords(targets[i], &area);
        if (x >= area.x1 && x <= area.x2 && y >= area.y1 && y <= area.y2) return true;
    }
    return false;
}

static void audio_control_icon(lv_event_t *event)
{
    unsigned index = (unsigned)(uintptr_t)lv_event_get_user_data(event);
    lv_obj_t *object = lv_event_get_target_obj(event);
    lv_area_t bounds; lv_obj_get_coords(object, &bounds);
    lv_draw_image_dsc_t image; lv_draw_image_dsc_init(&image);
    image.src = index == 0 ? &music_audio_minus : index == 2 ? &music_audio_plus : audio_input ? (audio_muted ? &music_audio_mic_muted : &music_audio_mic) : (audio_muted ? &music_audio_muted : &music_audio_speaker);
    image.recolor = lv_color_hex(audio_text_color); image.recolor_opa = LV_OPA_COVER;
    image.opa = audio_enabled[index] ? LV_OPA_COVER : LV_OPA_30;
    int icon_size = lv_obj_get_width(object) * 28 / 44;
    image.scale_x = image.scale_y = icon_size * 256 / 96;
    image.antialias = true;
    image.pivot.x = image.pivot.y = 0;
    int cx = (bounds.x1 + bounds.x2 + 1) / 2, cy = (bounds.y1 + bounds.y2 + 1) / 2;
    lv_area_t area = {cx - icon_size / 2, cy - icon_size / 2, cx - icon_size / 2 + 95, cy - icon_size / 2 + 95};
    lv_draw_image(lv_event_get_layer(event), &image, &area);
}

static void control_icon(lv_event_t *event)
{
    lv_obj_t *object = lv_event_get_target_obj(event);
    unsigned index = (unsigned)(uintptr_t)lv_event_get_user_data(event);
    lv_layer_t *layer = lv_event_get_layer(event);
    lv_area_t bounds;
    lv_obj_get_coords(object, &bounds);
    int size = lv_obj_get_width(object), cx = (bounds.x1 + bounds.x2 + 1) / 2, cy = (bounds.y1 + bounds.y2 + 1) / 2;
    int height = size * 14 / 44, bar = size * 6 / 44;
    if (bar < 2) bar = 2;
    lv_color_t color = lv_color_hex(roon_text_color);
    lv_opa_t opacity = (index == 0 && !roon_previous) || (index == 2 && !roon_next) ? LV_OPA_30 : LV_OPA_COVER;
    opacity = (lv_opa_t)((unsigned)opacity * roon_chrome_opacity / 255);
    lv_draw_rect_dsc_t rectangle;
    lv_draw_rect_dsc_init(&rectangle);
    rectangle.bg_color = color; rectangle.bg_opa = opacity;
    if (index == 1 && roon_playing) {
        for (int side = -1; side <= 1; side += 2) {
            int x = cx + side * size * 7 / 44;
            lv_area_t area = { x - bar / 2, cy - height, x + (bar - 1) / 2, cy + height - 1 };
            lv_draw_rect(layer, &rectangle, &area);
        }
    } else {
        int icon_size = (size * (index == 1 ? 34 : 24) + 22) / 44;
        lv_draw_image_dsc_t image;
        lv_draw_image_dsc_init(&image);
        image.src = index == 0 ? &reicon_previous : index == 1 ? &reicon_play : &reicon_next;
        image.recolor = color; image.recolor_opa = LV_OPA_COVER; image.opa = opacity;
        image.scale_x = image.scale_y = icon_size * 256 / REICON_MASK_SIDE;
        lv_area_t area = {cx - icon_size / 2, cy - icon_size / 2, 0, 0};
        area.x2 = area.x1 + REICON_MASK_SIDE - 1;
        area.y2 = area.y1 + REICON_MASK_SIDE - 1;
        lv_draw_image(layer, &image, &area);
    }
}

static void music_badge_icon(lv_event_t *event)
{
    bool heart = lv_event_get_user_data(event) != NULL;
    lv_obj_t *object = lv_event_get_target_obj(event);
    lv_area_t bounds;
    lv_obj_get_coords(object, &bounds);
    lv_draw_image_dsc_t image;
    lv_draw_image_dsc_init(&image);
    image.src = heart ? (music_liked ? &music_heart_filled : &music_heart) :
        music_player == MUSIC_SPOTIFY ? &music_spotify : music_player == MUSIC_APPLE_MUSIC ? &music_apple_music : &music_roon;
    image.recolor = lv_color_hex(heart && music_liked ? 0x1ed760 : !heart && music_player == MUSIC_SPOTIFY ? 0x1ed760 : 0xffffff);
    image.recolor_opa = heart ? LV_OPA_COVER : LV_OPA_TRANSP;
    int inset = heart ? 8 : 0;
    int size = heart ? 20 : 30;
    lv_area_t area = {bounds.x1 + inset, bounds.y1 + inset, bounds.x1 + inset + size - 1, bounds.y1 + inset + size - 1};
    lv_draw_image(lv_event_get_layer(event), &image, &area);
}

static void speed_dial_badge(lv_event_t *event)
{
    unsigned index = (unsigned)(uintptr_t)lv_event_get_user_data(event);
    speed_dial_status_t status = speed_dial_shown.speed_dial.buttons[index].status;
    lv_area_t bounds; lv_obj_get_coords(lv_event_get_target_obj(event), &bounds);
    lv_layer_t *layer = lv_event_get_layer(event);
    int cx = (bounds.x1 + bounds.x2 + 1) / 2, cy = (bounds.y1 + bounds.y2 + 1) / 2;
    if (status == SPEED_DIAL_RUNNING) {
        lv_draw_arc_dsc_t arc; lv_draw_arc_dsc_init(&arc);
        arc.center = (lv_point_t){cx, cy}; arc.radius = 6; arc.width = 2;
        arc.color = lv_color_hex(current_palette.foreground); arc.rounded = true;
        arc.start_angle = (int)fmod(module_animation_time * 240, 360);
        arc.end_angle = arc.start_angle + 250;
        lv_draw_arc(layer, &arc);
    } else {
        lv_draw_line_dsc_t line; lv_draw_line_dsc_init(&line);
        line.width = 2; line.round_start = line.round_end = true;
        line.color = lv_color_hex(status == SPEED_DIAL_SUCCESS ? current_palette.success : current_palette.danger);
        line.p1 = (lv_point_precise_t){cx - 5, cy + (status == SPEED_DIAL_SUCCESS ? 0 : -5)};
        line.p2 = (lv_point_precise_t){cx + (status == SPEED_DIAL_SUCCESS ? -1 : 5), cy + 5};
        lv_draw_line(layer, &line);
        line.p1 = line.p2;
        if (status == SPEED_DIAL_ERROR) line.p1 = (lv_point_precise_t){cx - 5, cy + 5};
        line.p2 = (lv_point_precise_t){cx + 5, cy - 5};
        lv_draw_line(layer, &line);
    }
}

void module_view_speed_dial_cancel(void)
{
    if (speed_dial_pressed_index >= 0) {
        lv_obj_set_style_border_width(speed_dial_panels[speed_dial_pressed_index], 0, 0);
        lv_obj_set_style_translate_y(speed_dial_panels[speed_dial_pressed_index], 0, 0);
    }
    speed_dial_pressed_index = -1;
    speed_dial_pressed.token[0] = '\0';
}

static bool speed_dial_atlas_ready(void)
{
    return speed_dial_active && roon_pixels && speed_dial_shown.art_id[0] &&
        !strcmp(speed_dial_shown.art_id, roon_art_id);
}

bool module_view_speed_dial_press(int x, int y, speed_dial_target_t *target)
{
    module_view_speed_dial_cancel();
    if (!speed_dial_atlas_ready() || !speed_dial_target_at(&speed_dial_shown, x, y, target)) return false;
    speed_dial_pressed = *target;
    speed_dial_pressed_index = target->index;
    speed_dial_pressed_x = x; speed_dial_pressed_y = y;
    lv_obj_t *panel = speed_dial_panels[target->index];
    lv_obj_set_style_border_color(panel, lv_color_hex(current_palette.foreground), 0);
    lv_obj_set_style_border_opa(panel, LV_OPA_50, 0);
    lv_obj_set_style_border_width(panel, 2, 0);
    lv_obj_set_style_translate_y(panel, 2, 0);
    return true;
}

bool module_view_speed_dial_press_valid(int x, int y, const speed_dial_target_t *target)
{
    return speed_dial_atlas_ready() && speed_dial_pressed_index >= 0 &&
        !memcmp(target, &speed_dial_pressed, sizeof(*target)) && speed_dial_target_valid(&speed_dial_shown, x, y, target);
}

void module_view_set_artwork(const char *id, const uint8_t *pixels)
{
    if (!roon_pixels) return;
    if (id && id[0] && pixels) {
        memcpy(roon_pixels, pixels, ROON_ART_BYTES);
        memcpy(roon_art_id, id, sizeof(roon_art_id));
    } else roon_art_id[0] = '\0';
    if (!speed_dial_atlas_ready()) module_view_speed_dial_cancel();
    lv_image_cache_drop(&roon_image_source);
    lv_obj_invalidate(roon_image);
    for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) {
        lv_image_cache_drop(&speed_dial_sources[i]);
        lv_obj_invalidate(speed_dial_images[i]);
    }
}

void module_view_create(lv_obj_t *screen)
{
    body = group(screen);
    usage = group(body);
    usage_card(0, 79);
    usage_card(1, 245);
    mail = group(body);
    for (unsigned i = 0; i < MAIL_ROWS; ++i) mail_card(i);

    empty = group(body);
    empty_title = label(empty, 73, 205, 320, &lv_font_geist_22, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
    empty_detail = label(empty, 83, 240, 300, &lv_font_geist_16, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);
    lv_obj_set_height(empty_detail, 40);
    lv_label_set_long_mode(empty_detail, LV_LABEL_LONG_WRAP);

    clock_view = group(body);
    /* Match the browser's 156 px line box at y=155 using the subset's baseline. */
    clock_time = label(clock_view, 33, 187, 400, &lv_font_geist_pixel_128, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
    lv_obj_set_style_text_color(clock_time, lv_color_black(), LV_PART_SELECTED);
    lv_obj_set_style_bg_color(clock_time, lv_color_black(), LV_PART_SELECTED);
    clock_weekday = label(clock_view, 73, 308, 320, &lv_font_geist_22, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);

    audio_picker = group(body);
    audio_picker_footer = label(audio_picker, 33, 410, 400, &lv_font_geist_mono_16, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);
    for (unsigned i = 0; i < 3; ++i) {
        audio_rows[i] = rounded(audio_picker, 63, 135 + 68 * i, 340, 60, 12, 0x151515);
        audio_names[i] = label(audio_rows[i], 50, 3, 276, &lv_font_geist_22, COLOR_TEXT, LV_TEXT_ALIGN_LEFT);
        lv_obj_set_height(audio_names[i], 54);
        audio_checks[i] = rounded(audio_rows[i], 14, 18, 24, 24, 0, 0);
        lv_obj_set_style_bg_opa(audio_checks[i], LV_OPA_TRANSP, 0);
        lv_obj_add_event_cb(audio_checks[i], audio_check_icon, LV_EVENT_DRAW_MAIN, NULL);
    }
    audio_view = group(body);
    audio_title = label(audio_view, 33, 85, 400, &lv_font_geist_22, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
    audio_value = label(audio_view, 33, 130, 400, &lv_font_geist_pixel_128, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
    audio_device = label(audio_view, 33, 300, 400, &lv_font_geist_22, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);
    for (unsigned i = 0; i < 3; ++i) {
        audio_controls[i] = rounded(audio_view, 0, 358, 64, 64, LV_RADIUS_CIRCLE, 0);
        lv_obj_set_style_bg_opa(audio_controls[i], LV_OPA_TRANSP, 0);
        lv_obj_add_event_cb(audio_controls[i], audio_control_icon, LV_EVENT_DRAW_MAIN, (void *)(uintptr_t)i);
    }
    roon = group(body);
    roon_art = rounded(roon, 138, 70, 190, 190, 16, 0x151515);
    lv_obj_set_style_clip_corner(roon_art, true, 0);
    roon_placeholder = label(roon_art, 0, 82, 190, &lv_font_geist_22, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);
    lv_label_set_text(roon_placeholder, "");
#ifdef ESP_PLATFORM
    roon_pixels = heap_caps_calloc(1, ROON_ART_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
#else
    roon_pixels = lv_malloc(ROON_ART_BYTES);
#endif
    roon_image = lv_image_create(roon_art);
    passive(roon_image);
    if (roon_pixels) {
        roon_image_source = (lv_image_dsc_t){ .header = { .magic = LV_IMAGE_HEADER_MAGIC,
            .cf = LV_COLOR_FORMAT_RGB565, .w = ROON_ART_SIDE, .h = ROON_ART_SIDE, .stride = ROON_ART_SIDE * 2 },
            .data_size = ROON_ART_BYTES, .data = roon_pixels };
        lv_image_set_src(roon_image, &roon_image_source);
        lv_image_set_pivot(roon_image, ROON_ART_SIDE / 2, ROON_ART_SIDE / 2);
    }
    show(roon_image, false);
    music_source_badge = rounded(roon_art, 8, 8, 30, 30, LV_RADIUS_CIRCLE, 0x151515);
    music_like_badge = rounded(roon_art, 146, 146, 36, 36, LV_RADIUS_CIRCLE, 0x151515);
    lv_obj_set_style_bg_opa(music_source_badge, LV_OPA_TRANSP, 0);
    lv_obj_set_style_bg_opa(music_like_badge, 221, 0);
    lv_obj_add_event_cb(music_source_badge, music_badge_icon, LV_EVENT_DRAW_MAIN, NULL);
    lv_obj_add_event_cb(music_like_badge, music_badge_icon, LV_EVENT_DRAW_MAIN, (void *)1);
    show(music_source_badge, false); show(music_like_badge, false);
    roon_chrome = group(roon);
    roon_title = label(roon_chrome, 58, 280, 350, &lv_font_geist_22, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
    roon_artist = label(roon_chrome, 58, 314, 350, &lv_font_geist_16, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);
    for (unsigned i = 0; i < 3; ++i) {
        roon_controls[i] = rounded(roon_chrome, 0, 365, 44, 44, LV_RADIUS_CIRCLE, 0x000000);
        lv_obj_set_style_bg_opa(roon_controls[i], LV_OPA_TRANSP, 0);
        lv_obj_add_event_cb(roon_controls[i], control_icon, LV_EVENT_DRAW_MAIN, (void *)(uintptr_t)i);
    }

    speed_dial_view = group(body);
    speed_dial_footer = label(speed_dial_view, 0, 416, 466, &lv_font_geist_mono_16, COLOR_MUTED, LV_TEXT_ALIGN_CENTER);
    for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) {
        speed_dial_panels[i] = rounded(speed_dial_view, 0, 0, 96, 96, LV_RADIUS_CIRCLE, 0x151515);
        speed_dial_images[i] = lv_image_create(speed_dial_panels[i]);
        passive(speed_dial_images[i]);
        lv_image_set_pivot(speed_dial_images[i], 0, 0);
        speed_dial_labels[i] = label(speed_dial_view, 0, 0, 112, &lv_font_geist_16, COLOR_TEXT, LV_TEXT_ALIGN_CENTER);
        speed_dial_badges[i] = rounded(speed_dial_view, 0, 0, 14, 14, LV_RADIUS_CIRCLE, 0);
        lv_obj_add_event_cb(speed_dial_badges[i], speed_dial_badge, LV_EVENT_DRAW_MAIN, (void *)(uintptr_t)i);
        show(speed_dial_images[i], false); show(speed_dial_badges[i], false);
    }

    lv_obj_t *mask_canvas = lv_canvas_create(body);
    lv_canvas_set_buffer(mask_canvas, checking_mask, CHECKING_WIDTH, CHECKING_HEIGHT, LV_COLOR_FORMAT_RGB565);
    passive(mask_canvas);
    show(mask_canvas, false);
    assert(lv_draw_buf_width_to_stride(CHECKING_WIDTH, LV_COLOR_FORMAT_RGB565) == CHECKING_WIDTH * sizeof(uint16_t));
    lv_layer_t layer;
    lv_canvas_init_layer(mask_canvas, &layer);
    lv_draw_label_dsc_t descriptor;
    lv_draw_label_dsc_init(&descriptor);
    descriptor.text = "Checking";
    descriptor.font = &lv_font_geist_16;
    descriptor.color = lv_color_white();
    descriptor.align = LV_TEXT_ALIGN_CENTER;
    descriptor.flag = LV_TEXT_FLAG_EXPAND;
    lv_area_t area = {0, 0, CHECKING_WIDTH - 1, CHECKING_HEIGHT - 1};
    lv_draw_label(&layer, &descriptor, &area);
    lv_canvas_finish_layer(mask_canvas, &layer);

    checking_canvas = lv_canvas_create(body);
    lv_canvas_set_buffer(checking_canvas, checking_pixels, CHECKING_WIDTH, CHECKING_HEIGHT, LV_COLOR_FORMAT_RGB565);
    lv_obj_set_pos(checking_canvas, (466 - CHECKING_WIDTH) / 2, 408);
    passive(checking_canvas);
    show(checking_canvas, false);

    for (unsigned i = 0; i < MODULE_LIMIT; ++i) {
        dots[i] = rounded(screen, 0, 0, 5, 5, LV_RADIUS_CIRCLE, COLOR_TRACK);
        show(dots[i], false);
    }
    show(body, false);
}

static void style_label(lv_obj_t *object, int x, int y, int width, const lv_font_t *font,
                        int lines, uint32_t color, lv_text_align_t align)
{
    lv_obj_set_pos(object, x, y);
    lv_obj_set_size(object, width, font->line_height * lines);
    lv_obj_set_style_text_font(object, font, 0);
    lv_obj_set_style_text_color(object, lv_color_hex(color), 0);
    lv_obj_set_style_text_align(object, align, 0);
}

static void style_panel(lv_obj_t *panel, int x, int y, int width, int height, int radius, uint32_t color)
{
    lv_obj_set_pos(panel, x, y);
    lv_obj_set_size(panel, width, height);
    lv_obj_set_style_radius(panel, radius, 0);
    lv_obj_set_style_bg_color(panel, lv_color_hex(color), 0);
}

static void apply_roon_pose(roon_pose_t pose)
{
    int size = (int)lround(pose.size);
    style_panel(roon_art, (int)lround(pose.x), (int)lround(pose.y), size, size, (int)lround(pose.radius), current_palette.surface);
    double radians = pose.angle * 3.141592653589793 / 180;
    double overscan = fmax(1, 1 + fmax(0, 1 - 2 * pose.radius / pose.size) * (fabs(cos(radians)) + fabs(sin(radians)) - 1));
    lv_image_set_scale(roon_image, (uint32_t)ceil(size * 256.0 / ROON_ART_SIDE * overscan));
    lv_obj_set_pos(roon_image, (size - ROON_ART_SIDE) / 2, (size - ROON_ART_SIDE) / 2);
    lv_image_set_rotation(roon_image, (int)lround(fmod(pose.angle, 360) * 10));
    lv_obj_set_pos(roon_placeholder, 0, (size - lv_font_geist_22.line_height) / 2);
    lv_obj_set_width(roon_placeholder, size);
    lv_obj_set_pos(music_source_badge, 8, 8);
    lv_obj_set_pos(music_like_badge, size - 44, size - 44);
    show(music_source_badge, music_player != MUSIC_SYSTEM && !roon_motion.expanded);
    show(music_like_badge, music_can_like && !roon_motion.expanded);
    lv_opa_t opacity = (lv_opa_t)lround(pose.chrome * 255);
    bool opacity_changed = opacity != roon_chrome_opacity;
    roon_chrome_opacity = opacity;
    lv_obj_set_y(roon_chrome, (int)lround((1 - pose.chrome) * 12));
    show(roon_chrome, roon_chrome_opacity > 0);
    lv_obj_set_style_text_opa(roon_title, roon_chrome_opacity, 0);
    lv_obj_set_style_text_opa(roon_artist, roon_chrome_opacity, 0);
    if (opacity_changed) for (unsigned i = 0; i < 3; ++i) lv_obj_invalidate(roon_controls[i]);
}

bool module_view_roon_like_hit(int x, int y)
{
    if (!roon_render_active || !music_can_like || roon_motion.expanded || !roon_motion_settled(&roon_motion)) return false;
    int left = lv_obj_get_x(roon_art) + lv_obj_get_x(music_like_badge);
    int top = lv_obj_get_y(roon_art) + lv_obj_get_y(music_like_badge);
    return x >= left - 4 && x < left + 40 && y >= top - 4 && y < top + 40;
}

bool module_view_roon_art_hit(int x, int y)
{
    return roon_render_active && module_touch_rounded_art(x, y, lv_obj_get_x(roon_art), lv_obj_get_y(roon_art),
        lv_obj_get_width(roon_art), lv_obj_get_style_radius(roon_art, 0));
}

bool module_view_roon_controls_ready(void)
{
    return roon_render_active && !roon_motion.expanded && roon_motion_settled(&roon_motion);
}

bool module_view_card_at(int x, int y, module_card_target_t *target)
{
    if (!open_token[0] || (open_module != DISPLAY_USAGE && open_module != DISPLAY_HEY)) return false;
    int count = open_module == DISPLAY_USAGE ? 2 : MAIL_ROWS;
    for (int i = count - 1; i >= 0; --i) {
        lv_obj_t *panel = open_module == DISPLAY_USAGE ? usage_panels[i] : mail_panels[i];
        if (!lv_obj_is_visible(panel)) continue;
        lv_obj_update_layout(panel);
        lv_area_t bounds;
        lv_obj_get_coords(panel, &bounds);
        /* Designer text can extend past a borderless card. Include its visible
         * children so tapping the displayed label opens the same card. */
        for (uint32_t child = 0; child < lv_obj_get_child_count(panel); ++child) {
            lv_obj_t *object = lv_obj_get_child(panel, child);
            if (lv_obj_has_flag(object, LV_OBJ_FLAG_HIDDEN)) continue;
            lv_area_t area;
            lv_obj_get_coords(object, &area);
            if (area.x1 < bounds.x1) bounds.x1 = area.x1;
            if (area.y1 < bounds.y1) bounds.y1 = area.y1;
            if (area.x2 > bounds.x2) bounds.x2 = area.x2;
            if (area.y2 > bounds.y2) bounds.y2 = area.y2;
        }
        if (module_touch_rect(x, y, bounds.x1, bounds.y1, lv_area_get_width(&bounds), lv_area_get_height(&bounds))) {
            if (!open_cards[i]) return false;
            *target = (module_card_target_t){ .module = open_module, .index = (uint8_t)i };
            memcpy(target->token, open_token, sizeof(target->token));
            return true;
        }
    }
    return false;
}

static void update_metric(unsigned index, const module_metric_t *metric, const char *provider,
                          const char *fallback, bool backgrounds, const usage_design_t *design)
{
    int size = design->numberSize ? design->numberSize : backgrounds ? 44 : 56;
    const lv_font_t *font = design_font(DESIGN_FONT_USAGE_VALUE, size);
    int inner = design->width - design->padding * 2;
    int pill_max = inner / 2 + 9;
    if (pill_max > 163) pill_max = 163;
    int number_width = inner - pill_max - 7;
    int value_y = (int)lround(65 - design_font_line(size) / 2.0) + design_font_inset(font, size) + design->valueOffset;
    style_label(values[index], design->padding, value_y,
        number_width, font, 1, design->textColor, LV_TEXT_ALIGN_LEFT);
    style_label(providers[index], design->padding, design->titleY, inner,
        design_font(DESIGN_FONT_USAGE_PROVIDER, design->titleSize), 1, design->mutedColor, LV_TEXT_ALIGN_LEFT);
    style_label(resets[index], design->padding, design->resetY, inner,
        design_font(DESIGN_FONT_USAGE_RESET, design->resetSize), 1, design->mutedColor, LV_TEXT_ALIGN_LEFT);
    char value[16];
    if (metric->available) snprintf(value, sizeof(value), "%ld%%", lroundf(metric->remaining));
    else snprintf(value, sizeof(value), "--");
    lv_label_set_text(values[index], value);
    lv_label_set_text(providers[index], metric->provider[0] ? metric->provider : provider);
    lv_obj_set_style_bg_color(pills[index], lv_color_hex(current_palette.track), 0);
    fit_pill(pills[index], captions[index], metric->label[0] ? metric->label : fallback, design);
    lv_label_set_text(resets[index], metric->reset[0] ? metric->reset : "Reset unavailable");
    bool has_fill = metric->available && metric->remaining > 0;
    int width = (int)lroundf(inner * metric->remaining / 100);
    style_panel(bar_tracks[index], design->padding, design->barY, inner, design->barHeight,
        design->barHeight / 2, design->trackColor);
    lv_obj_set_width(bar_fills[index], width > 0 ? width : 1);
    lv_obj_set_height(bar_fills[index], design->barHeight);
    int radius = width / 2 < design->barHeight / 2 ? width / 2 : design->barHeight / 2;
    lv_obj_set_style_radius(bar_fills[index], radius, 0);
    show(bar_fills[index], has_fill);
    uint32_t color = metric->remaining <= 10 ? design->lowColor : metric->remaining <= 25 ? design->warnColor : design->fillColor;
    lv_obj_set_style_bg_color(bar_fills[index], lv_color_hex(color), 0);
    bool patterned = design->barStyle != 0;
    if (patterned && !bar_pattern_pixels[index]) {
        size_t bytes = USAGE_PATTERN_MAX_WIDTH * USAGE_PATTERN_MAX_HEIGHT * sizeof(uint32_t);
#ifdef ESP_PLATFORM
        bar_pattern_pixels[index] = heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
#else
        bar_pattern_pixels[index] = lv_malloc(bytes);
#endif
    }
    int fill_width = has_fill ? (width > 0 ? width : 1) : 0;
    patterned = patterned && usage_pattern_render(bar_pattern_pixels[index], inner, design->barHeight,
        design->barStyle, design->barPixelSize, design->barPixelGap, fill_width, design->trackColor, color);
    show(bar_tracks[index], !patterned); show(bar_patterns[index], patterned);
    if (patterned) {
        assert(lv_draw_buf_width_to_stride(inner, LV_COLOR_FORMAT_ARGB8888) == (uint32_t)inner * sizeof(uint32_t));
        lv_canvas_set_buffer(bar_patterns[index], bar_pattern_pixels[index], inner, design->barHeight, LV_COLOR_FORMAT_ARGB8888);
        lv_obj_set_pos(bar_patterns[index], design->padding, design->barY);
        lv_obj_invalidate(bar_patterns[index]);
    }
}

void module_view_update(const module_snapshot_t *module, bool disconnected)
{
    module_design_t design;
    display_module_design(module, &design);
    current_palette = module->palette;
    lv_obj_set_style_text_color(empty_title, lv_color_hex(current_palette.foreground), 0);
    lv_obj_set_style_text_color(empty_detail, lv_color_hex(current_palette.muted), 0);
    lv_obj_set_style_bg_color(roon_art, lv_color_hex(current_palette.surface), 0);
    lv_obj_set_style_text_color(clock_time, lv_color_hex(current_palette.background), LV_PART_SELECTED);
    lv_obj_set_style_bg_color(clock_time, lv_color_hex(current_palette.background), LV_PART_SELECTED);
    bool visible = module->kind != DISPLAY_FACE;
    bool ready = module->status == MODULE_READY && !disconnected;
    open_module = module->kind;
    memset(open_cards, 0, sizeof(open_cards));
    open_token[0] = '\0';
    if (ready && (module->kind == DISPLAY_USAGE || module->kind == DISPLAY_HEY)) {
        memcpy(open_token, module->open_token, sizeof(open_token));
        if (module->kind == DISPLAY_USAGE) {
            open_cards[0] = module->primary.openable;
            open_cards[1] = module->secondary.openable;
        } else for (unsigned i = 0; i < module->message_count; ++i) open_cards[i] = module->messages[i].openable;
    }
    roon_render_active = visible && ready && module->kind == DISPLAY_ROON;
    if (!roon_render_active) roon_motion.initialized = false;
    speed_dial_active = visible && ready && module->kind == DISPLAY_SPEED_DIAL;
    if (speed_dial_pressed_index >= 0 && (!speed_dial_active ||
        !speed_dial_target_valid(module, speed_dial_pressed_x, speed_dial_pressed_y, &speed_dial_pressed))) module_view_speed_dial_cancel();
    if (speed_dial_active) speed_dial_shown = *module;
    bool dial_empty = speed_dial_active && !module->speed_dial.count;
    bool mail_empty = ready && module->kind == DISPLAY_HEY && module->message_count == 0;
    clock_blink_active = visible && ready && module->kind == DISPLAY_CLOCK && module->blink_separator;
    checking_active = visible && ready && module->kind != DISPLAY_CLOCK && module->kind != DISPLAY_ROON && module->refreshing;
    show(checking_canvas, checking_active);
    show(body, visible);
    show(usage, visible && ready && module->kind == DISPLAY_USAGE);
    show(mail, visible && ready && module->kind == DISPLAY_HEY && !mail_empty);
    show(clock_view, visible && ready && module->kind == DISPLAY_CLOCK);
    show(audio_view, visible && ready && module->kind == DISPLAY_AUDIO && !module->audio_picker_open);
    show(audio_picker, visible && ready && module->kind == DISPLAY_AUDIO && module->audio_picker_open);
    show(roon, visible && ready && module->kind == DISPLAY_ROON);
    show(speed_dial_view, speed_dial_active && !dial_empty);
    show(empty, visible && (!ready || mail_empty || dial_empty));
    lv_opa_t card_opacity = module->show_card_backgrounds ? LV_OPA_COVER : LV_OPA_TRANSP;
    for (unsigned i = 0; i < 2; ++i) lv_obj_set_style_bg_opa(usage_panels[i], card_opacity, 0);
    for (unsigned i = 0; i < MAIL_ROWS; ++i) lv_obj_set_style_bg_opa(mail_panels[i], card_opacity, 0);
    for (unsigned i = 0; i < MODULE_LIMIT; ++i) {
        show(dots[i], module->show_navigation && module->count > 1 && i < module->count);
        lv_obj_set_pos(dots[i], 231 - ((int)module->count - 1) * 8 + (int)i * 16, module->kind == DISPLAY_SPEED_DIAL ? 446 : 432);
        lv_obj_set_style_bg_color(dots[i], lv_color_hex(i == module->index ? current_palette.accent : current_palette.track), 0);
    }
    if (!visible) return;
    if (!ready) {
        const char *title = "Not connected";
        if (disconnected) title = "Disconnected";
        else if (module->status == MODULE_LOADING) title = "Connecting";
        else if (module->status == MODULE_AUTH) title = "Sign in needed";
        else if (module->status == MODULE_ERROR) title = "Could not refresh";
        lv_label_set_text(empty_title, title);
        const char *detail = module->detail[0] ? module->detail : "Set up this module in the playground";
        if (disconnected) detail = "Reconnect the desktop bridge";
        else if (module->status == MODULE_LOADING)
            detail = module->kind == DISPLAY_USAGE ? "CodexBar" : module->kind == DISPLAY_CLOCK ? "Clock" : module->kind == DISPLAY_ROON ? (module->player == MUSIC_SPOTIFY ? "Spotify" : module->player == MUSIC_SYSTEM ? "Now Playing" : module->player == MUSIC_APPLE_MUSIC ? "Apple Music" : "Roon") : module->kind == DISPLAY_AUDIO ? "Audio" : "HEY";
        lv_label_set_text(empty_detail, detail);
    } else if (module->kind == DISPLAY_USAGE) {
        const usage_design_t *layout = &design.usage;
        bool primary_present = module->primary.available || module->primary.label[0] || module->primary.reset[0];
        bool secondary_present = module->secondary.available || module->secondary.label[0] || module->secondary.reset[0];
        show(usage_panels[0], primary_present);
        show(usage_panels[1], secondary_present);
        int first = module->show_card_backgrounds ? 75 : 83;
        int step = layout->height + (module->show_card_backgrounds ? 24 : 8) + layout->rowGap;
        style_panel(usage_panels[0], layout->x, (secondary_present ? first : 158) + layout->offsetY,
            layout->width, layout->height, layout->radius, layout->cardColor);
        style_panel(usage_panels[1], layout->x, (primary_present ? first + step : 158) + layout->offsetY,
            layout->width, layout->height, layout->radius, layout->cardColor);
        update_metric(0, &module->primary, module->title, "Session", module->show_card_backgrounds, layout);
        update_metric(1, &module->secondary, module->title, "Weekly", module->show_card_backgrounds, layout);
    } else if (module->kind == DISPLAY_SPEED_DIAL) {
        const speedDial_design_t *layout = &design.speedDial;
        const lv_font_t *font = design_font(DESIGN_FONT_SPEED_DIAL_LABEL, layout->labelSize);
        bool artwork = roon_pixels && module->art_id[0] && !strcmp(module->art_id, roon_art_id);
        speed_dial_geometry_t slots[SPEED_DIAL_BUTTON_LIMIT];
        unsigned slot_count = speed_dial_layout(module, slots);
        for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) {
            bool present = i < module->speed_dial.count && i < slot_count;
            show(speed_dial_panels[i], present);
            show(speed_dial_labels[i], present && (module->speed_dial.list || module->speed_dial.show_labels));
            show(speed_dial_badges[i], present && module->speed_dial.buttons[i].status != SPEED_DIAL_IDLE);
            if (!present) continue;
            const speed_dial_button_t *button = &module->speed_dial.buttons[i];
            speed_dial_geometry_t geometry = slots[i];
            speed_dial_rect_t *panel = &geometry.button, *icon = &geometry.icon, *text = &geometry.label;
            style_panel(speed_dial_panels[i], panel->x, panel->y, panel->width, panel->height, geometry.radius,
                button->has_color ? button->color : current_palette.surface);
            lv_obj_set_style_bg_opa(speed_dial_panels[i], module->speed_dial.list ? LV_OPA_TRANSP : LV_OPA_COVER, 0);
            lv_obj_set_style_opa(speed_dial_panels[i], button->enabled ? LV_OPA_COVER : LV_OPA_40, 0);
            lv_obj_set_pos(speed_dial_images[i], icon->x - panel->x, icon->y - panel->y);
            if (roon_pixels) {
                lv_image_cache_drop(&speed_dial_sources[i]);
                speed_dial_sources[i] = (lv_image_dsc_t){ .header = { .magic = LV_IMAGE_HEADER_MAGIC,
                    .cf = LV_COLOR_FORMAT_RGB565, .w = SPEED_DIAL_ATLAS_ICON_SIZE, .h = SPEED_DIAL_ATLAS_ICON_SIZE,
                    .stride = ROON_ART_SIDE * 2 }, .data_size = ROON_ART_SIDE * SPEED_DIAL_ATLAS_ICON_SIZE * 2,
                    .data = roon_pixels + speed_dial_icon_offset(button->icon_index) };
                lv_image_set_src(speed_dial_images[i], &speed_dial_sources[i]);
                lv_image_set_scale(speed_dial_images[i], icon->width * 256 / SPEED_DIAL_ATLAS_ICON_SIZE);
            }
            show(speed_dial_images[i], artwork);
            style_label(speed_dial_labels[i], text->x, text->y + design_font_inset(font, layout->labelSize), text->width,
                font, 1, button->enabled ? layout->textColor : layout->mutedColor,
                module->speed_dial.list ? LV_TEXT_ALIGN_LEFT : LV_TEXT_ALIGN_CENTER);
            lv_label_set_text(speed_dial_labels[i], button->label);
            speed_dial_rect_t *badge = &geometry.status;
            style_panel(speed_dial_badges[i], badge->x, badge->y, badge->width, badge->height, LV_RADIUS_CIRCLE, current_palette.background);
            lv_obj_invalidate(speed_dial_badges[i]);
        }
        show(speed_dial_footer, module->page_count > 1);
        lv_obj_set_style_text_color(speed_dial_footer, lv_color_hex(layout->mutedColor), 0);
        char page[20]; snprintf(page, sizeof(page), "%u / %u", module->page_index + 1, module->page_count);
        lv_label_set_text(speed_dial_footer, page);
        if (dial_empty) {
            lv_label_set_text(empty_title, "Speed Dial");
            lv_label_set_text(empty_detail, "Add buttons in Settings");
        }
    } else if (module->kind == DISPLAY_AUDIO) {
        const audio_design_t *layout = &design.audio;
        if (module->audio_picker_open) {
            const lv_font_t *picker_font = design_font(DESIGN_FONT_AUDIO_PICKER, 26);
            for (unsigned i = 0; i < 3; ++i) {
                show(audio_rows[i], i < module->audio_row_count);
                if (i >= module->audio_row_count) continue;
                style_panel(audio_rows[i], 63, 135 + 68 * i, 340, 60, 12, current_palette.surface);
                lv_obj_set_style_bg_opa(audio_rows[i], LV_OPA_TRANSP, 0);
                int width = 276;
                int height = picker_font->line_height;
                style_label(audio_names[i], 50, (60 - height) / 2, width, picker_font, 1, layout->textColor, LV_TEXT_ALIGN_LEFT);
                lv_obj_set_height(audio_names[i], height);
                lv_label_set_text(audio_names[i], module->audio_devices[i].name);
                show(audio_checks[i], module->audio_devices[i].active); lv_obj_invalidate(audio_checks[i]);
            }
            show(audio_picker_footer, module->page_count > 1);
            lv_obj_set_y(audio_picker_footer, layout->controlsY + layout->controlSize / 2 - lv_font_geist_mono_16.line_height / 2);
            lv_obj_set_style_text_color(audio_picker_footer, lv_color_hex(layout->mutedColor), 0);
            int digits = module->page_count >= 100 ? 3 : module->page_count >= 10 ? 2 : 1;
            char page[20]; snprintf(page, sizeof(page), "%*u / %u", digits, module->page_index + 1, module->page_count);
            lv_label_set_text(audio_picker_footer, page);
            return;
        }
        const lv_font_t *font = design_font(DESIGN_FONT_AUDIO_VALUE, layout->valueSize);
        style_label(audio_title, 33, layout->titleY, 400, design_font(DESIGN_FONT_AUDIO_TITLE, layout->titleSize), 1, layout->textColor, LV_TEXT_ALIGN_CENTER);
        style_label(audio_value, 33, layout->valueY + design_font_inset(font, layout->valueSize), 400, font, 1, layout->textColor, LV_TEXT_ALIGN_CENTER);
        style_label(audio_device, 33, layout->deviceY, 400, design_font(DESIGN_FONT_AUDIO_DEVICE, layout->deviceSize), 1, layout->mutedColor, LV_TEXT_ALIGN_CENTER);
        lv_label_set_text(audio_title, module->audio_input ? "Input" : "Output");
        char value[12];
        if (module->audio_has_volume) snprintf(value, sizeof(value), "%d%%", (int)lroundf(module->audio_volume));
        else snprintf(value, sizeof(value), "--");
        lv_label_set_text(audio_value, value); lv_label_set_text(audio_device, module->audio_device_name);
        audio_muted = module->audio_muted; audio_input = module->audio_input; audio_text_color = layout->textColor;
        audio_enabled[0] = module->audio_can_volume && module->audio_volume > 0;
        audio_enabled[1] = module->audio_can_mute;
        audio_enabled[2] = module->audio_can_volume && module->audio_volume < 100;
        for (unsigned i = 0; i < 3; ++i) {
            int center = 233 + ((int)i - 1) * (layout->controlSize + layout->gap);
            style_panel(audio_controls[i], center - layout->controlSize / 2, layout->controlsY, layout->controlSize, layout->controlSize, LV_RADIUS_CIRCLE, 0);
            lv_obj_set_style_bg_opa(audio_controls[i], LV_OPA_TRANSP, 0);
            lv_obj_invalidate(audio_controls[i]);
        }
    } else if (module->kind == DISPLAY_CLOCK) {
        const clock_design_t *layout = &design.clock;
        lv_text_align_t align = design_text_align(layout->align);
        const lv_font_t *font = design_font(DESIGN_FONT_CLOCK_TIME, layout->timeSize);
        style_label(clock_time, layout->x, layout->y + design_font_inset(font, layout->timeSize), layout->width,
            font, 1, layout->textColor, align);
        style_label(clock_weekday, layout->x, layout->dayY, layout->width,
            design_font(DESIGN_FONT_CLOCK_DAY, layout->daySize), 1, layout->mutedColor, align);
        clock_separator_visible = true;
        lv_label_set_text_selection_start(clock_time, LV_DRAW_LABEL_NO_TXT_SEL);
        lv_label_set_text_selection_end(clock_time, LV_DRAW_LABEL_NO_TXT_SEL);
        lv_label_set_text(clock_time, module->time);
        lv_label_set_text(clock_weekday, module->weekday);
        show(clock_weekday, module->weekday[0] != '\0');
    } else if (module->kind == DISPLAY_ROON) {
        const roon_design_t *layout = &design.roon;
        bool artwork = roon_pixels && module->art_id[0] && !strcmp(module->art_id, roon_art_id);
        show(roon_image, artwork); show(roon_placeholder, !artwork);
        lv_obj_set_style_text_color(roon_placeholder, lv_color_hex(layout->mutedColor), 0);
        style_label(roon_title, 58, layout->titleY, 350, design_font(DESIGN_FONT_ROON_TITLE, layout->titleSize), 1, layout->textColor, LV_TEXT_ALIGN_CENTER);
        style_label(roon_artist, 58, layout->artistY, 350, design_font(DESIGN_FONT_ROON_ARTIST, layout->artistSize), 1, layout->mutedColor, LV_TEXT_ALIGN_CENTER);
        lv_label_set_text(roon_title, module->track[0] ? module->track : "Nothing playing");
        lv_label_set_text(roon_artist, module->artist);
        music_player = module->player; music_can_like = module->can_like; music_liked = module->liked;
        lv_obj_invalidate(music_source_badge); lv_obj_invalidate(music_like_badge);
        roon_playing = module->playing; roon_previous = module->can_previous; roon_next = module->can_next;
        roon_text_color = layout->textColor;
        for (int i = 0; i < 3; ++i) {
            int center = 233 + (i - 1) * (layout->controlSize + layout->gap);
            style_panel(roon_controls[i], center - layout->controlSize / 2, layout->controlsY, layout->controlSize, layout->controlSize, LV_RADIUS_CIRCLE, layout->accentColor);
            lv_obj_invalidate(roon_controls[i]);
        }
        roon_motion_set(&roon_motion, module->expanded, layout->animateArtwork, layout->spinArtwork, module->playing, (466 - layout->artSize) / 2,
            layout->artY, layout->artSize, layout->artRadius, module_animation_time);
        apply_roon_pose(roon_motion.pose);
    } else {
        const hey_design_t *layout = &design.hey;
        if (mail_empty) {
            lv_label_set_text(empty_title, module->detail[0] ? module->detail : "You are all caught up");
            lv_label_set_text(empty_detail, "");
        }
        for (unsigned i = 0; i < MAIL_ROWS; ++i) {
            show(mail_panels[i], i < module->message_count && i < (unsigned)layout->rows);
            style_panel(mail_panels[i], layout->x, layout->y + (int)i * (layout->height + layout->gap),
                layout->width, layout->height, layout->radius, layout->cardColor);
            int inner = layout->width - layout->padding * 2;
            style_label(mail_senders[i], layout->padding, layout->senderY, inner,
                design_font(DESIGN_FONT_HEY_SENDER, layout->senderSize), 1, layout->textColor, LV_TEXT_ALIGN_LEFT);
            style_label(mail_subjects[i], layout->padding, layout->subjectY, inner,
                design_font(DESIGN_FONT_HEY_SUBJECT, layout->subjectSize), layout->lines, layout->mutedColor, LV_TEXT_ALIGN_LEFT);
            if (i < module->message_count && i < (unsigned)layout->rows) {
                lv_label_set_text(mail_senders[i], module->messages[i].sender);
                lv_label_set_text(mail_subjects[i], module->messages[i].subject);
            }
        }
    }
}

void module_view_tick(double animation_time)
{
    if (isfinite(animation_time)) module_animation_time = animation_time;
    if (speed_dial_active) for (unsigned i = 0; i < speed_dial_shown.speed_dial.count; ++i)
        if (speed_dial_shown.speed_dial.buttons[i].status == SPEED_DIAL_RUNNING) lv_obj_invalidate(speed_dial_badges[i]);
    if (roon_render_active) apply_roon_pose(roon_motion_sample(&roon_motion, animation_time));
    bool separator_visible = !clock_blink_active || !isfinite(animation_time) || animation_time < 0 || fmod(animation_time, 1) < .5;
    if (separator_visible != clock_separator_visible) {
        clock_separator_visible = separator_visible;
        // Color only the existing glyph; text and ellipsis geometry never change.
        const char *text = lv_label_get_text(clock_time), *colon = strchr(text, ':');
        uint32_t index = !separator_visible && colon ? (uint32_t)(colon - text) : LV_DRAW_LABEL_NO_TXT_SEL;
        lv_label_set_text_selection_start(clock_time, index);
        lv_label_set_text_selection_end(clock_time, index == LV_DRAW_LABEL_NO_TXT_SEL ? index : index + 1);
    }
    if (!checking_active) return;
    uint16_t bg = device_rgb565(current_palette.background);
    for (unsigned i=0; i<CHECKING_WIDTH*CHECKING_HEIGHT; ++i) checking_pixels[i]=bg;
    face_shimmer_blit_palette(checking_mask, CHECKING_WIDTH, CHECKING_HEIGHT,
                      checking_pixels, CHECKING_WIDTH, CHECKING_HEIGHT, 0, 0, animation_time, false,
                      current_palette.muted, current_palette.foreground);
    lv_obj_invalidate(checking_canvas);
}
