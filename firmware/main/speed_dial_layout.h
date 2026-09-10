#pragma once
#include "display_module.h"
#include <math.h>

// Logical 466px coordinates, mirrored by shared/speed-dial-layout.mjs.
typedef struct { int x, y, width, height; } speed_dial_rect_t;
typedef struct {
    speed_dial_rect_t button, icon, label, status;
    int radius;
} speed_dial_geometry_t;

typedef struct { int cx, cy, distance; bool used; } speed_dial_candidate_t;
// Doubled coordinates preserve the half-pixel centers of odd-sized edge targets.
typedef struct { int x, y, size, cx2, cy2; } speed_dial_packed_point_t;

static inline int speed_dial_min(int a, int b) { return a < b ? a : b; }
static inline int speed_dial_round(double value) { return (int)floor(value + .5); }

static inline speed_dial_geometry_t speed_dial_grid_slot(int x, int y, int size, int label_height,
                                                        const speed_dial_snapshot_t *dial, const speedDial_design_t *d)
{
    int icon = speed_dial_min(d->iconSize, size - 20);
    speed_dial_geometry_t slot = {
        .button = {x, y, size, size}, .radius = size / 2,
        .icon = {x + (size - icon) / 2, y + (size - icon) / 2, icon, icon},
        .status = {x + size - 20, y + 6, 14, 14},
    };
    if (dial->show_labels) slot.label = (speed_dial_rect_t){x - d->gap / 2 + 2, y + size + 8, size + d->gap - 4, label_height};
    return slot;
}

static inline bool speed_dial_candidate_before(speed_dial_candidate_t a, speed_dial_candidate_t b)
{
    return a.distance < b.distance || (a.distance == b.distance &&
        (a.cy < b.cy || (a.cy == b.cy && a.cx < b.cx)));
}

static inline bool speed_dial_clears_controls(int x, int y, int size)
{
    const speed_dial_rect_t controls[] = {{205, 416, 56, 22}, {181, 444, 104, 8}};
    double radius = size / 2.0, cx = x + radius, cy = y + radius;
    for (unsigned i = 0; i < 2; ++i) {
        const speed_dial_rect_t *rect = &controls[i];
        double dx = cx - fmax(rect->x, fmin(cx, rect->x + rect->width));
        double dy = cy - fmax(rect->y, fmin(cy, rect->y + rect->height));
        double clearance = radius + (i == 0 ? 16 : 2);
        if (dx * dx + dy * dy < clearance * clearance) return false;
    }
    return true;
}

static inline bool speed_dial_nested_fit(const speed_dial_packed_point_t *point,
                                         const speed_dial_packed_point_t *chosen, unsigned count, int gap)
{
    double cx = point->cx2 / 2.0, cy = point->cy2 / 2.0;
    double dx = cx - 233, dy = cy - 233, limit = 221 - point->size / 2.0;
    if (dx * dx + dy * dy > limit * limit ||
        !speed_dial_clears_controls(point->x, point->y, point->size)) return false;
    unsigned neighbours = 0;
    for (unsigned i = 0; i < count; ++i) {
        double dx = cx - chosen[i].cx2 / 2.0, dy = cy - chosen[i].cy2 / 2.0;
        double spacing = (point->size + chosen[i].size) / 2.0 + gap;
        double distance = dx * dx + dy * dy;
        if (distance < spacing * spacing) return false;
        if (distance <= (spacing + 1) * (spacing + 1)) neighbours++;
    }
    return neighbours >= 2;
}

static inline unsigned speed_dial_packed_slots(const speed_dial_snapshot_t *dial, const speedDial_design_t *d,
                                               int label_height, bool single_page, speed_dial_geometry_t *slots)
{
    int label_space = dial->show_labels ? label_height + 8 : 0;
    bool dense = !dial->rectangular && !dial->show_labels;
    int bottom_limit = dense ? 454 : 408;
    unsigned capacity = dense ? SPEED_DIAL_BUTTON_LIMIT : 9;
    int size = speed_dial_min(d->buttonSize, (384 - 2 * d->gap) / 3 - label_space);
    int center = speed_dial_round((dense ? 206 : 216) - label_space / 2.0) + d->offsetY;
    // Fit five rows of large circles above the page counter before adding four side circles.
    if (dense) while (size > 48) {
        int pitch = size + d->gap, row = (int)ceil(sqrt(pitch * pitch - (pitch / 2) * (pitch / 2)));
        double half_pixel = (size % 2) / 2.0, top = center + half_pixel - 2 * row;
        double limit = 221 - size / 2.0;
        if (half_pixel * half_pixel + (top - 233) * (top - 233) <= limit * limit && center + 2 * row + (size + 1) / 2 <= 400) break;
        size--;
    }
    int pitch_x = size + d->gap;
    int pitch_y = dense ? (int)ceil(sqrt(pitch_x * pitch_x - (pitch_x / 2) * (pitch_x / 2))) : size + label_space + d->gap;
    speed_dial_candidate_t candidates[81];
    unsigned count = 0;
    for (int row = -4; row <= 4; ++row) for (int col = -4; col <= 4; ++col) {
        double stagger = !dial->rectangular && row % 2 != 0 ? .5 : 0;
        double offset = (col + stagger) * pitch_x;
        int row_distance = row < 0 ? -row : row;
        if (dense && (row_distance > 2 || fabs(offset) > (2 - row_distance) * pitch_x / 2.0)) continue;
        int cx = dense ? 233 + (offset < 0 ? -1 : 1) * speed_dial_round(fabs(offset)) : speed_dial_round(233 + offset);
        int cy = center + row * pitch_y;
        speed_dial_geometry_t slot = speed_dial_grid_slot(speed_dial_round(cx - size / 2.0),
            speed_dial_round(cy - size / 2.0), size, label_height, dial, d);
        if (slot.button.x < 12 || slot.button.x + size > 454 || slot.button.y < 12 || slot.button.y + size > bottom_limit ||
            (dense && !speed_dial_clears_controls(slot.button.x, slot.button.y, size))) continue;
        double dx = slot.button.x + size / 2.0 - 233, dy = slot.button.y + size / 2.0 - 233, limit = 221 - size / 2.0;
        if (!dial->rectangular && dx * dx + dy * dy > limit * limit) continue;
        const speed_dial_rect_t *label = &slot.label;
        if (dial->show_labels) {
            if (label->x < 12 || label->x + label->width > 454 || label->y + label->height > 408) continue;
            bool outside = false;
            if (!dial->rectangular) for (unsigned corner = 0; corner < 4; ++corner) {
                int x = label->x + (corner % 2 ? label->width : 0) - 233;
                int y = label->y + (corner / 2 ? label->height : 0) - 233;
                if (x * x + y * y > 221 * 221) outside = true;
            }
            if (outside) continue;
        }
        speed_dial_candidate_t point = {.cx = cx, .cy = cy, .distance = (cx - 233) * (cx - 233) + (cy - center) * (cy - center)};
        unsigned index = count++;
        while (index && speed_dial_candidate_before(point, candidates[index - 1])) {
            candidates[index] = candidates[index - 1];
            index--;
        }
        candidates[index] = point;
    }
    speed_dial_packed_point_t chosen[SPEED_DIAL_BUTTON_LIMIT];
    unsigned chosen_count = 0;
    for (unsigned i = 0; i < count; ++i) {
        if (candidates[i].used) continue;
        unsigned opposite = i;
        for (unsigned j = 0; j < count; ++j) {
            if (candidates[j].cx == 466 - candidates[i].cx && candidates[j].cy == 2 * center - candidates[i].cy) { opposite = j; break; }
        }
        if (dense && opposite == i && (candidates[i].cx != 233 || candidates[i].cy != center)) continue;
        unsigned pair_count = opposite == i ? 1 : 2;
        if (chosen_count + pair_count > capacity) continue;
        unsigned pair[2] = {i, opposite};
        for (unsigned j = 0; j < pair_count; ++j) {
            unsigned candidate = pair[j];
            if (candidates[candidate].used) continue;
            candidates[candidate].used = true;
            const speed_dial_candidate_t *point = &candidates[candidate];
            int x = speed_dial_round(point->cx - size / 2.0), y = speed_dial_round(point->cy - size / 2.0);
            chosen[chosen_count++] = (speed_dial_packed_point_t){x, y, size, 2 * x + size, 2 * y + size};
        }
    }
    // Grow from neighbouring circles, not the rim. Require two existing neighbours for each new button.
    if (dense && chosen_count > 1) {
        double cx = chosen[0].cx2 / 2.0, cy = chosen[0].cy2 / 2.0;
        while (chosen_count + 2 <= capacity) {
            speed_dial_packed_point_t best[2] = {0};
            double best_radius = 0;
            bool found = false;
            for (int edge_size = size * 3 / 4 < 48 ? 48 : size * 3 / 4; edge_size >= 48 && !found; --edge_size) {
                for (unsigned i = 0; i < chosen_count; ++i) for (unsigned j = i + 1; j < chosen_count; ++j) {
                    const speed_dial_packed_point_t *a = &chosen[i], *b = &chosen[j];
                    double ax = a->cx2 / 2.0, ay = a->cy2 / 2.0;
                    double dx = b->cx2 / 2.0 - ax, dy = b->cy2 / 2.0 - ay, distance = dx * dx + dy * dy;
                    // Half a pixel allows rounding while keeping both gaps within one pixel of the setting.
                    double ra = (a->size + edge_size) / 2.0 + d->gap + .5, rb = (b->size + edge_size) / 2.0 + d->gap + .5;
                    if (!distance || distance > (ra + rb) * (ra + rb) || distance < (ra - rb) * (ra - rb)) continue;
                    double along = (ra * ra - rb * rb + distance) / (2 * distance);
                    double height = sqrt(fmax(0, ra * ra / distance - along * along));
                    for (int side = -1; side <= 1; side += 2) {
                        int x = speed_dial_round(ax + along * dx + side * height * dy - edge_size / 2.0);
                        int y = speed_dial_round(ay + along * dy - side * height * dx - edge_size / 2.0);
                        int opposite_x = chosen[0].cx2 - x - edge_size, opposite_y = chosen[0].cy2 - y - edge_size;
                        speed_dial_packed_point_t edges[] = {
                            {x, y, edge_size, 2 * x + edge_size, 2 * y + edge_size},
                            {opposite_x, opposite_y, edge_size, 2 * opposite_x + edge_size, 2 * opposite_y + edge_size},
                        };
                        if (y > opposite_y || (y == opposite_y && x > opposite_x) ||
                            !speed_dial_nested_fit(&edges[0], chosen, chosen_count, d->gap) ||
                            !speed_dial_nested_fit(&edges[1], chosen, chosen_count, d->gap) ||
                            (x - opposite_x) * (x - opposite_x) + (y - opposite_y) * (y - opposite_y) < (edge_size + d->gap) * (edge_size + d->gap)) continue;
                        double rx = x + edge_size / 2.0 - cx, ry = y + edge_size / 2.0 - cy, radius = rx * rx + ry * ry;
                        if (!found || radius < best_radius || (radius == best_radius && (y < best[0].y || (y == best[0].y && x < best[0].x)))) {
                            best[0] = edges[0]; best[1] = edges[1]; best_radius = radius; found = true;
                        }
                    }
                }
            }
            if (!found) break;
            chosen[chosen_count++] = best[0];
            chosen[chosen_count++] = best[1];
        }
    }
    int shift_x = 0, shift_y = 0;
    unsigned visible = dial->count < chosen_count ? dial->count : chosen_count;
    // Centre the visible group without changing packing, button order or page capacity.
    if (slots && dense && single_page && visible) {
        int left = 466, right = 0, top = 466, bottom = 0;
        for (unsigned i = 0; i < visible; ++i) {
            const speed_dial_packed_point_t *p = &chosen[i];
            if (p->x < left) left = p->x;
            if (p->x + p->size > right) right = p->x + p->size;
            if (p->y < top) top = p->y;
            if (p->y + p->size > bottom) bottom = p->y + p->size;
        }
        shift_x = speed_dial_round(233 - (left + right) / 2.0);
        shift_y = speed_dial_round(233 + d->offsetY - (top + bottom) / 2.0);
    }
    // Retain centre-first ordering and opposite pairs on partial pages.
    if (slots) for (unsigned i = 0; i < chosen_count; ++i) {
        const speed_dial_packed_point_t *point = &chosen[i];
        speedDial_design_t slot_design = *d;
        if (point->size != size) {
            int icon = speed_dial_min(d->iconSize, (int)floor((double)d->iconSize * point->size / size));
            slot_design.iconSize = icon < 24 ? 24 : icon;
        }
        slots[i] = speed_dial_grid_slot(point->x + shift_x, point->y + shift_y, point->size, label_height, dial, &slot_design);
    }
    return chosen_count;
}

// Capacity is independent of the number of buttons on the current page.
static inline unsigned speed_dial_layout(const module_snapshot_t *module, speed_dial_geometry_t *slots)
{
    if (!module || module->kind != DISPLAY_SPEED_DIAL) return 0;
    const speed_dial_snapshot_t *dial = &module->speed_dial;
    if ((dial->grid_size != 0 && dial->grid_size != 4 && dial->grid_size != 6) || (dial->list_rows != 3 && dial->list_rows != 4)) return 0;
    module_design_t design; display_module_design(module, &design);
    const speedDial_design_t *d = &design.speedDial;
    int label_height = (int)ceil(d->labelSize * 1.25), center = 225 + d->offsetY;
    unsigned count = dial->list ? dial->list_rows : dial->grid_size;
    if (!dial->list && !count) return speed_dial_packed_slots(dial, d, label_height, module->page_count == 1, slots);
    if (!slots) return count;
    if (dial->list) {
        int height = speed_dial_min(d->rowHeight, (328 - ((int)count - 1) * d->gap) / (int)count);
        int top = speed_dial_round(center - ((int)count * height + ((int)count - 1) * d->gap) / 2.0);
        int icon = speed_dial_min(d->iconSize, height - 16);
        for (unsigned i = 0; i < count; ++i) {
            int y = top + (int)i * (height + d->gap);
            slots[i] = (speed_dial_geometry_t){ .button = {73, y, 320, height}, .radius = 20,
                .icon = {89, y + (height - icon) / 2, icon, icon},
                .label = {103 + icon, y + (height - label_height) / 2, 254 - icon, label_height},
                .status = {363, y + (height - 14) / 2, 14, 14}, };
        }
    } else {
        int rows = count / 2, label_space = dial->show_labels ? label_height + 8 : 0;
        int size = speed_dial_min(speed_dial_min(d->buttonSize, count == 6 ? 84 : 112), (340 - (rows - 1) * d->gap) / rows - label_space);
        int height = size + label_space;
        int left = speed_dial_round(233 - (size * 2 + d->gap) / 2.0), top = speed_dial_round(center - (rows * height + (rows - 1) * d->gap) / 2.0);
        for (unsigned i = 0; i < count; ++i) slots[i] = speed_dial_grid_slot(left + (int)(i % 2) * (size + d->gap),
            top + (int)(i / 2) * (height + d->gap), size, label_height, dial, d);
    }
    return count;
}
