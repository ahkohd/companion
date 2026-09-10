#pragma once
#include "speed_dial_layout.h"

#define SPEED_DIAL_ATLAS_ICON_SIZE 32
#define SPEED_DIAL_ATLAS_COLUMNS (160 / SPEED_DIAL_ATLAS_ICON_SIZE)

typedef struct {
    char id[SPEED_DIAL_ID_CAPACITY], token[41], art_id[41];
    speed_dial_snapshot_t dial;
    module_design_t design;
    uint16_t page_index, page_count;
    uint8_t index;
} speed_dial_target_t;

bool speed_dial_geometry(const module_snapshot_t *module, unsigned index, speed_dial_geometry_t *out);
bool speed_dial_target_at(const module_snapshot_t *module, int x, int y, speed_dial_target_t *target);
bool speed_dial_target_valid(const module_snapshot_t *module, int x, int y, const speed_dial_target_t *target);
// Return the 32-pixel tile's byte offset in the 160-pixel-wide atlas.
unsigned speed_dial_icon_offset(unsigned index);
