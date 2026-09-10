#include "speed_dial.h"
#include "screen_rotation.h"
#include "module_touch.h"
#include "roon_artwork.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static bool rectangles_overlap(speed_dial_rect_t a, speed_dial_rect_t b)
{
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

static bool label_hits_circle(speed_dial_rect_t label, speed_dial_rect_t button)
{
    double radius = button.width / 2.0, cx = button.x + radius, cy = button.y + radius;
    double x = fmax(label.x, fmin(cx, label.x + label.width)), y = fmax(label.y, fmin(cy, label.y + label.height));
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) < radius * radius;
}

static void check_packing(const module_snapshot_t *module)
{
    if (module->speed_dial.list || module->speed_dial.grid_size) return;
    speed_dial_geometry_t slots[SPEED_DIAL_BUTTON_LIMIT];
    unsigned count = speed_dial_layout(module, slots);
    module_design_t design; display_module_design(module, &design);
    assert(count > 0 && count <= SPEED_DIAL_BUTTON_LIMIT);
    for (unsigned i = 0; i < count; ++i) {
        if (module->page_count == 1 && i >= module->speed_dial.count) continue;
        speed_dial_rect_t button = slots[i].button, label = slots[i].label;
        assert(button.width >= 48 && slots[i].icon.width >= 24);
        bool dense = !module->speed_dial.rectangular && !module->speed_dial.show_labels;
        assert(button.x >= 12 && button.x + button.width <= 454 && button.y >= 12 && button.y + button.height <= (dense ? 454 : 408));
        if (dense) {
            assert(count % 2 == 1);
            if (i % 2) {
                speed_dial_rect_t opposite = slots[i + 1].button, middle = slots[0].button;
                assert(2 * button.x + button.width + 2 * opposite.x + opposite.width == 2 * (2 * middle.x + middle.width));
                assert(2 * button.y + button.height + 2 * opposite.y + opposite.height == 2 * (2 * middle.y + middle.height));
            }
            if (module->page_count > 1) assert(speed_dial_clears_controls(button.x, button.y, button.width));
            double radius = button.width / 2.0, cx = button.x + radius, cy = button.y + radius;
            double nx = cx - fmax(181, fmin(cx, 285)), ny = cy - fmax(444, fmin(cy, 452));
            assert(nx * nx + ny * ny >= (radius + 2) * (radius + 2));
            if (button.width < slots[0].button.width) {
                unsigned neighbours = 0;
                for (unsigned j = 0; j < i; ++j) {
                    speed_dial_rect_t other = slots[j].button;
                    double dx = button.x + button.width / 2.0 - other.x - other.width / 2.0;
                    double dy = button.y + button.height / 2.0 - other.y - other.height / 2.0;
                    double spacing = (button.width + other.width) / 2.0 + design.speedDial.gap + 1;
                    if (dx * dx + dy * dy <= spacing * spacing) neighbours++;
                }
                assert(neighbours >= 2);
            }
        }
        if (!module->speed_dial.rectangular) {
            double dx = button.x + button.width / 2.0 - 233, dy = button.y + button.height / 2.0 - 233;
            double limit = 221 - button.width / 2.0;
            assert(dx * dx + dy * dy <= limit * limit);
        }
        if (label.width) {
            assert(label.x >= 12 && label.x + label.width <= 454 && label.y + label.height <= 408);
            if (!module->speed_dial.rectangular) for (unsigned corner = 0; corner < 4; ++corner) {
                int x = label.x + (corner % 2 ? label.width : 0) - 233, y = label.y + (corner / 2 ? label.height : 0) - 233;
                assert(x * x + y * y <= 221 * 221);
            }
        }
        for (unsigned j = i + 1; j < count; ++j) {
            speed_dial_rect_t other = slots[j].button;
            double dx = button.x + button.width / 2.0 - other.x - other.width / 2.0;
            double dy = button.y + button.height / 2.0 - other.y - other.height / 2.0;
            double spacing = (button.width + other.width) / 2.0 + (dense ? design.speedDial.gap : 0);
            assert(dx * dx + dy * dy >= spacing * spacing);
            if (label.width && slots[j].label.width) {
                assert(!rectangles_overlap(label, slots[j].label));
                assert(!label_hits_circle(label, other) && !label_hits_circle(slots[j].label, button));
            }
        }
    }
}

static void check_targets(const module_snapshot_t *module, unsigned rotation_step)
{
    check_packing(module);
    for (unsigned i = 0; i < module->speed_dial.count; ++i) {
        speed_dial_geometry_t slot;
        assert(speed_dial_geometry(module, i, &slot));
        assert(slot.button.width > 0 && slot.button.height > 0 && slot.icon.width > 0);
        assert(slot.button.x >= 0 && slot.button.y >= 0 && slot.button.x + slot.button.width < 466 && slot.button.y + slot.button.height < 466);
        int x = slot.button.x + slot.button.width / 2, y = slot.button.y + slot.button.height / 2;
        bool enabled = module->speed_dial.buttons[i].enabled && module->speed_dial.buttons[i].status != SPEED_DIAL_RUNNING;
        speed_dial_target_t target;
        assert(speed_dial_target_at(module, x, y, &target) == enabled);
        if (!enabled) continue;
        assert(target.index == i && speed_dial_target_valid(module, x, y, &target));
        assert(!speed_dial_target_valid(module, 0, 0, &target));
        for (unsigned rotation = 0; rotation < 360; rotation += rotation_step) {
            double radians = rotation * 3.141592653589793 / 180;
            int physical_x = lround(232.5 + (x - 232.5) * cos(radians) - (y - 232.5) * sin(radians));
            int physical_y = lround(232.5 + (x - 232.5) * sin(radians) + (y - 232.5) * cos(radians));
            int logical_x, logical_y;
            screen_unrotate_point(rotation, physical_x, physical_y, &logical_x, &logical_y);
            assert(speed_dial_target_valid(module, logical_x, logical_y, &target));
        }
        module_snapshot_t changed = *module;
        if (module->speed_dial.count > 1) {
            unsigned other = (i + 1) % module->speed_dial.count;
            changed.speed_dial.buttons[other].status = SPEED_DIAL_SUCCESS;
            assert(speed_dial_target_valid(&changed, x, y, &target));
        }
        changed = *module;
        changed.open_token[0] = changed.open_token[0] == 'a' ? 'b' : 'a';
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.page_index++;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.speed_dial.buttons[i].enabled = false;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.speed_dial.buttons[i].status = SPEED_DIAL_RUNNING;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.speed_dial.buttons[i].id[0] = '_';
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.speed_dial.show_labels = !changed.speed_dial.show_labels;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; display_module_design(module, &changed.design); changed.has_design = true; changed.design.speedDial.gap++;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.speed_dial.rectangular = !changed.speed_dial.rectangular;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.art_id[0] = changed.art_id[0] == 'a' ? 'b' : 'a';
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        changed = *module; changed.kind = DISPLAY_ROON;
        assert(!speed_dial_target_valid(&changed, x, y, &target));
        module_touch_t touch;
        module_touch_begin(&touch, x, y, 0);
        module_touch_move(&touch, x + 70, y);
        assert(module_touch_end(&touch, x + 70, y, 100000) == MODULE_TOUCH_PREVIOUS);
        module_touch_begin(&touch, x, y, 0);
        module_touch_move(&touch, x, y - 70);
        assert(module_touch_end(&touch, x, y - 70, 100000) == MODULE_TOUCH_PAGE_NEXT);
        module_touch_begin(&touch, x, y, 0);
        module_touch_move(&touch, x + 20, y);
        assert(module_touch_end(&touch, x, y, 100000) == MODULE_TOUCH_NONE);
    }
    for (unsigned i = 0; i < SPEED_DIAL_BUTTON_LIMIT; ++i) {
        unsigned offset = speed_dial_icon_offset(i);
        assert(offset / 2 / 160 == i / 5 * 32);
        assert(offset / 2 % 160 == i % 5 * 32);
        assert(offset + (31 * 160 + 32) * 2 <= ROON_ART_BYTES);
    }
}

int main(int argc, char **argv)
{
    unsigned rotation_step = argc > 1 && !strcmp(argv[1], "--sample-rotations") ? 37 : 1;
    char line[16384];
    while (fgets(line, sizeof(line), stdin)) {
        cJSON *root = cJSON_Parse(line);
        struct { unsigned before; module_snapshot_t module; unsigned after; } guarded = {.before = 0xaabbccdd, .after = 0xaabbccdd};
        bool valid = cJSON_IsObject(root) && display_module_parse(root, &guarded.module);
        assert(guarded.before == 0xaabbccdd && guarded.after == 0xaabbccdd);
        if (!valid) puts("null");
        else {
            module_snapshot_t *module = &guarded.module;
            check_targets(module, rotation_step);
            printf("{\"kind\":%u,\"count\":%u,\"capacity\":%u,\"page\":%u,\"pages\":%u,\"slots\":[", module->kind, module->speed_dial.count, speed_dial_layout(module, NULL), module->page_index, module->page_count);
            for (unsigned i = 0; i < module->speed_dial.count; ++i) {
                speed_dial_geometry_t g; assert(speed_dial_geometry(module, i, &g));
                printf("%s{\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"radius\":%d,\"icon\":{\"x\":%d,\"y\":%d,\"size\":%d},\"label\":", i ? "," : "", g.button.x, g.button.y, g.button.width, g.button.height, g.radius, g.icon.x, g.icon.y, g.icon.width);
                if (g.label.width) printf("{\"x\":%d,\"y\":%d,\"width\":%d,\"height\":%d,\"align\":\"%s\"}", g.label.x,g.label.y,g.label.width,g.label.height,module->speed_dial.list?"left":"center");
                else printf("null");
                printf(",\"status\":{\"x\":%d,\"y\":%d,\"size\":%d}}",g.status.x,g.status.y,g.status.width);
            }
            puts("]}");
        }
        cJSON_Delete(root);
    }
    return 0;
}
