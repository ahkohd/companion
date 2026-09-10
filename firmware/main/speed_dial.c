#include "speed_dial.h"
#include "module_touch.h"
#include <math.h>
#include <string.h>

static int minimum(int a, int b) { return a < b ? a : b; }

bool speed_dial_geometry(const module_snapshot_t *module, unsigned index, speed_dial_geometry_t *out)
{
    if (!module || !out || module->kind != DISPLAY_SPEED_DIAL || index >= module->speed_dial.count || index >= SPEED_DIAL_BUTTON_LIMIT) return false;
    speed_dial_geometry_t slots[SPEED_DIAL_BUTTON_LIMIT];
    unsigned count = speed_dial_layout(module, slots);
    if (index >= count) return false;
    *out = slots[index];
    return true;
}

static bool rounded_hit(int x, int y, const speed_dial_geometry_t *geometry)
{
    const speed_dial_rect_t *r = &geometry->button;
    if (!module_touch_rect(x, y, r->x, r->y, r->width, r->height)) return false;
    int radius = minimum(geometry->radius, minimum(r->width, r->height) / 2);
    int cx = x < r->x + radius ? r->x + radius : x >= r->x + r->width - radius ? r->x + r->width - radius : x;
    int cy = y < r->y + radius ? r->y + radius : y >= r->y + r->height - radius ? r->y + r->height - radius : y;
    int dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
}

bool speed_dial_target_at(const module_snapshot_t *module, int x, int y, speed_dial_target_t *target)
{
    if (!module || !target || module->kind != DISPLAY_SPEED_DIAL || module->status != MODULE_READY || !module->open_token[0]) return false;
    speed_dial_geometry_t slots[SPEED_DIAL_BUTTON_LIMIT];
    unsigned count = speed_dial_layout(module, slots);
    for (unsigned i = 0; i < module->speed_dial.count && i < count; ++i) {
        const speed_dial_button_t *button = &module->speed_dial.buttons[i];
        if (!button->enabled || button->status == SPEED_DIAL_RUNNING || !rounded_hit(x, y, &slots[i])) continue;
        *target = (speed_dial_target_t){0};
        memcpy(target->id, button->id, sizeof(target->id));
        memcpy(target->token, module->open_token, sizeof(target->token));
        memcpy(target->art_id, module->art_id, sizeof(target->art_id));
        target->dial = module->speed_dial;
        // Feedback on another button does not change the bound action.
        for (unsigned j = 0; j < SPEED_DIAL_BUTTON_LIMIT; ++j) target->dial.buttons[j].status = SPEED_DIAL_IDLE;
        display_module_design(module, &target->design);
        target->page_index = module->page_index;
        target->page_count = module->page_count;
        target->index = i;
        return true;
    }
    return false;
}

bool speed_dial_target_valid(const module_snapshot_t *module, int x, int y, const speed_dial_target_t *target)
{
    if (!module || !target || !target->token[0] || module->kind != DISPLAY_SPEED_DIAL || module->status != MODULE_READY ||
        strcmp(module->open_token, target->token) || strcmp(module->art_id, target->art_id) ||
        module->page_index != target->page_index || module->page_count != target->page_count) return false;
    const speed_dial_snapshot_t *dial = &module->speed_dial, *pressed = &target->dial;
    if (dial->list != pressed->list || dial->show_labels != pressed->show_labels || dial->rectangular != pressed->rectangular ||
        dial->grid_size != pressed->grid_size || dial->list_rows != pressed->list_rows || dial->count != pressed->count ||
        target->index >= dial->count || dial->count > SPEED_DIAL_BUTTON_LIMIT) return false;
    for (unsigned i = 0; i < dial->count; ++i) {
        const speed_dial_button_t *a = &dial->buttons[i], *b = &pressed->buttons[i];
        if (strcmp(a->id, b->id) || strcmp(a->label, b->label) || a->color != b->color || a->has_color != b->has_color ||
            a->icon_index != b->icon_index || a->enabled != b->enabled) return false;
    }
    const speed_dial_button_t *button = &dial->buttons[target->index];
    if (!button->enabled || button->status == SPEED_DIAL_RUNNING || strcmp(button->id, target->id)) return false;
    module_design_t design; display_module_design(module, &design);
    if (memcmp(&design, &target->design, sizeof(design))) return false;
    speed_dial_geometry_t slots[SPEED_DIAL_BUTTON_LIMIT];
    unsigned count = speed_dial_layout(module, slots);
    return target->index < count && rounded_hit(x, y, &slots[target->index]);
}

unsigned speed_dial_icon_offset(unsigned index)
{
    if (index >= SPEED_DIAL_BUTTON_LIMIT) return 0;
    return ((index / SPEED_DIAL_ATLAS_COLUMNS * SPEED_DIAL_ATLAS_ICON_SIZE) * 160 + index % SPEED_DIAL_ATLAS_COLUMNS * SPEED_DIAL_ATLAS_ICON_SIZE) * 2;
}
