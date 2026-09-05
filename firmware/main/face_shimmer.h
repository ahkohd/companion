#pragma once
#include <stdbool.h>
#include <stdint.h>

// t is the shared host animation clock in seconds; u spans the text width (0..1).
uint32_t face_shimmer_color(double t, double u, bool reduced);
uint32_t face_name_shimmer_color(double t, double u, bool reduced);

// A white-on-black RGB565 text mask supplies antialiasing coverage. Returns ink pixels drawn.
int face_shimmer_blit(const uint16_t *mask, int mask_width, int mask_height,
                     uint16_t *pixels, int width, int height, int left, int top,
                     double t, bool reduced);

// Same sweep and coverage, with a caller-supplied RGB palette for secondary text.
int face_shimmer_blit_palette(const uint16_t *mask, int mask_width, int mask_height,
                     uint16_t *pixels, int width, int height, int left, int top,
                     double t, bool reduced, uint32_t base, uint32_t peak);
