#pragma once
#include "display_module.h"
#include "lvgl.h"

#include "attention_protocol.h"
void attention_view_create(lv_obj_t *screen);
void attention_view_update(const attention_snapshot_t *attention, const char *title, const device_palette_t *palette);
void attention_view_scroll(int delta);
const char *attention_view_action(int x, int y);

const attention_snapshot_t *attention_view_snapshot(void);

bool attention_view_body_hit(int x, int y);
