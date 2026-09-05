#ifndef MODULE_TOUCH_H
#define MODULE_TOUCH_H
#include <stdbool.h>
#include <stdint.h>

typedef enum {
    MODULE_TOUCH_NONE, MODULE_TOUCH_TAP, MODULE_TOUCH_NEXT, MODULE_TOUCH_PREVIOUS,
    MODULE_TOUCH_PAGE_NEXT, MODULE_TOUCH_PAGE_PREVIOUS
} module_touch_action_t;
typedef struct { int x, y, max_x, max_y; int64_t started_us; bool active; } module_touch_t;
void module_touch_begin(module_touch_t *touch, int x, int y, int64_t now);
void module_touch_move(module_touch_t *touch, int x, int y);
module_touch_action_t module_touch_end(module_touch_t *touch, int x, int y, int64_t now);
bool module_touch_rect(int x, int y, int left, int top, int width, int height);
// Roon controls: zero means no button; 1 previous, 2 play/pause, 3 next.
int module_touch_roon(int x, int y, int top, int size, int gap, bool previous, bool next);
bool module_touch_roon_art(int x, int y, int art_y, int art_size, int radius, bool expanded);
bool module_touch_rounded_art(int x, int y, int left, int top, int size, int radius);
#endif
