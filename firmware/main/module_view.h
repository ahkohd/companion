#ifndef MODULE_VIEW_H
#define MODULE_VIEW_H
#include "display_module.h"
#include "lvgl.h"

typedef struct { display_module_t module; uint8_t index; char token[41]; } module_card_target_t;

void module_view_create(lv_obj_t *screen);
void module_view_update(const module_snapshot_t *module, bool disconnected);
void module_view_tick(double animation_time);
void module_view_set_artwork(const char *id, const uint8_t *pixels);
bool module_view_roon_art_hit(int x, int y);
bool module_view_roon_controls_ready(void);
bool module_view_card_at(int x, int y, module_card_target_t *target);
#endif
