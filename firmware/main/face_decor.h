#pragma once
#include <stdint.h>

#define FACE_DECOR_MAX_POINTS 12
#define FACE_DECOR_MAX_ITEMS 24

typedef struct { uint32_t color; float alpha; int count; float points[FACE_DECOR_MAX_POINTS][2]; } face_polygon_t;

// Overlays alpha-blended RGB888 polygons onto an existing RGB565 buffer without clearing it.
// Points use the canonical face coordinates of face_model.c (center width/2, width*.45; scale width*.9/256)
// and are clipped to the canonical circle (radius 100) and to canonical y <= 70.
void face_draw_decor(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count);

// Shift the decoration layer down in canonical coordinates, keeping its local clipping.
void face_draw_decor_shifted(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, float offset_y);
void face_draw_decor_positioned(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, float offset_x, float offset_y);

void face_draw_decor_scaled(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, int face_scale);
