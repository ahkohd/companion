#include "module_touch.h"
#include <stdlib.h>

bool module_touch_rect(int x, int y, int left, int top, int width, int height)
{
    return width > 0 && height > 0 && x >= left && y >= top && x - left < width && y - top < height;
}

bool module_touch_roon_art(int x, int y, int art_y, int art_size, int radius, bool expanded)
{
    int left = (466 - art_size) / 2, top = art_y;
    if (expanded) { left = top = 18; art_size = 430; radius = 215; }
    return module_touch_rounded_art(x, y, left, top, art_size, radius);
}

bool module_touch_rounded_art(int x, int y, int left, int top, int art_size, int radius)
{
    if (x < left || y < top || x >= left + art_size || y >= top + art_size) return false;
    if (radius > art_size / 2) radius = art_size / 2;
    int cx = x < left + radius ? left + radius : x >= left + art_size - radius ? left + art_size - radius : x;
    int cy = y < top + radius ? top + radius : y >= top + art_size - radius ? top + art_size - radius : y;
    int dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
}

int module_touch_roon(int x, int y, int top, int size, int gap, bool previous, bool next)
{
    for (int i = 0; i < 3; ++i) {
        int dx = x - (233 + (i - 1) * (size + gap)), dy = y - (top + size / 2);
        if (dx * dx + dy * dy <= size * size / 4)
            return (i == 0 && !previous) || (i == 2 && !next) ? 0 : i + 1;
    }
    return 0;
}

void module_touch_begin(module_touch_t *touch, int x, int y, int64_t now)
{
    *touch = (module_touch_t){.x = x, .y = y, .started_us = now, .active = true};
}

void module_touch_move(module_touch_t *touch, int x, int y)
{
    if (!touch->active) return;
    int dx = abs(x - touch->x), dy = abs(y - touch->y);
    if (dx > touch->max_x) touch->max_x = dx;
    if (dy > touch->max_y) touch->max_y = dy;
}

module_touch_action_t module_touch_end(module_touch_t *touch, int x, int y, int64_t now)
{
    if (!touch->active) return MODULE_TOUCH_NONE;
    module_touch_move(touch, x, y);
    touch->active = false;
    int dx = x - touch->x, dy = y - touch->y;
    int64_t elapsed = now - touch->started_us;
    if (elapsed < 0 || elapsed > 1500000) return MODULE_TOUCH_NONE;
    if (abs(dx) >= 55 && abs(dx) * 4 > abs(dy) * 5) {
        return dx < 0 ? MODULE_TOUCH_NEXT : MODULE_TOUCH_PREVIOUS;
    }
    if (abs(dy) >= 55 && abs(dy) * 4 > abs(dx) * 5) {
        return dy < 0 ? MODULE_TOUCH_PAGE_NEXT : MODULE_TOUCH_PAGE_PREVIOUS;
    }
    if (elapsed <= 500000 && touch->max_x <= 16 && touch->max_y <= 16) return MODULE_TOUCH_TAP;
    return MODULE_TOUCH_NONE;
}

int module_touch_audio_row(int x, int y, unsigned count)
{
    if (count > 3) count = 3;
    for (unsigned i = 0; i < count; ++i) if (module_touch_rect(x, y, 63, 135 + 68 * i, 340, 60)) return (int)i;
    return -1;
}
