#include "attention_view.h"
#include "fonts/geist.h"
#include "design_fonts.h"
#include "esp_attr.h"
#include <math.h>
#include <string.h>
#include <ctype.h>

static lv_obj_t *panel, *heading, *viewport, *description, *buttons[2], *labels[2];
static EXT_RAM_BSS_ATTR attention_snapshot_t shown;
static int offset, body_top = 126, body_height = 199;

static lv_obj_t *box(lv_obj_t *parent, int x, int y, int width, int height)
{
    lv_obj_t *obj = lv_obj_create(parent);
    lv_obj_remove_style_all(obj);
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_pos(obj, x, y);
    lv_obj_set_size(obj, width, height);
    return obj;
}

static lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font)
{
    lv_obj_t *obj = lv_label_create(parent);
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_text_font(obj, font, 0);
    return obj;
}

void attention_view_create(lv_obj_t *screen)
{
    panel = box(screen, 0, 0, 466, 466);
    lv_obj_set_style_bg_opa(panel, LV_OPA_COVER, 0);
    heading = label(panel, &lv_font_geist_28);
    lv_obj_set_pos(heading, 73, 80);
    lv_obj_set_size(heading, 320, LV_SIZE_CONTENT);
    lv_obj_set_style_max_height(heading, 68, 0);
    lv_obj_set_style_text_align(heading, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(heading, LV_LABEL_LONG_WRAP);
    viewport = box(panel, 73, body_top, 320, body_height);
    description = label(viewport, &lv_font_geist_22);
    lv_obj_set_width(description, 320);
    lv_obj_set_style_text_line_space(description, 6, 0);
    for (int i = 0; i < 2; ++i) {
        buttons[i] = box(panel, 73, 353, 320, 53);
        lv_obj_set_style_bg_opa(buttons[i], LV_OPA_COVER, 0);
        lv_obj_set_style_radius(buttons[i], 16, 0);
        labels[i] = label(buttons[i], design_font(DESIGN_FONT_ATTENTION_ACTION, 18));
        lv_obj_set_style_text_align(labels[i], LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_width(labels[i], 300);
        lv_label_set_long_mode(labels[i], LV_LABEL_LONG_WRAP);
    }
    lv_obj_add_flag(panel, LV_OBJ_FLAG_HIDDEN);
}

void attention_view_update(const attention_snapshot_t *a, const char *title, const device_palette_t *palette)
{
    if (strcmp(a->id, shown.id) || a->revision != shown.revision || a->detail != shown.detail) offset = 0;
    shown = *a;
    if (!a->active || !a->detail) { lv_obj_add_flag(panel, LV_OBJ_FLAG_HIDDEN); return; }
    lv_obj_remove_flag(panel, LV_OBJ_FLAG_HIDDEN);
    lv_obj_move_foreground(panel);
    lv_obj_set_style_bg_color(panel, lv_color_hex(palette->background), 0);
    lv_obj_set_style_text_color(heading, lv_color_hex(palette->foreground), 0);
    lv_obj_set_style_text_color(description, lv_color_hex(palette->foreground), 0);
    lv_label_set_text(heading, title);
    lv_label_set_text(description, a->body);
    lv_obj_update_layout(heading);
    body_top = 80 + lv_obj_get_height(heading) + 20;
    body_height = (a->count == 2 ? 292 : 353) - 28 - body_top;
    lv_obj_set_y(viewport, body_top);
    lv_obj_set_height(viewport, body_height);
    lv_obj_set_y(description, -offset);
    for (unsigned i = 0; i < 2; ++i) {
        if (i >= a->count) { lv_obj_add_flag(buttons[i], LV_OBJ_FLAG_HIDDEN); continue; }
        lv_obj_remove_flag(buttons[i], LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_y(buttons[i], a->count == 2 ? 292 + (int)i * 61 : 353);
        lv_obj_set_style_bg_color(buttons[i], lv_color_hex(palette->surface), 0);
        lv_obj_set_style_text_color(labels[i], lv_color_hex(palette->foreground), 0);
        lv_obj_set_width(labels[i], 300);
        lv_label_set_text(labels[i], a->actions[i].label);
        lv_obj_center(labels[i]);
    }
}

void attention_view_scroll(int delta)
{
    lv_obj_update_layout(description);
    int max = lv_obj_get_height(description) - body_height;
    if (max < 0) max = 0;
    offset += delta;
    if (offset < 0) offset = 0;
    if (offset > max) offset = max;
    lv_obj_set_y(description, -offset);
}

const char *attention_view_action(int x, int y)
{
    if (!shown.active) return NULL;
    if (!shown.detail) return "open";
    if (x < 73 || x > 393) return NULL;
    for (unsigned i = 0; i < shown.count; ++i) {
        int top = shown.count == 2 ? 292 + (int)i * 61 : 353;
        if (y >= top && y <= top + 53) return shown.actions[i].id;
    }
    return NULL;
}

const attention_snapshot_t *attention_view_snapshot(void) { return &shown; }

bool attention_view_body_hit(int x, int y)
{
    return shown.active && shown.detail && x >= 73 && x <= 393 && y >= body_top && y <= body_top + body_height;
}
