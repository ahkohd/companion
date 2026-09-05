#pragma once
#include <stdbool.h>
#include <stdint.h>

#define USAGE_PATTERN_MAX_WIDTH 426
#define USAGE_PATTERN_MAX_HEIGHT 24

// Writes straight ARGB8888; zero-alpha gaps reveal the existing card/background.
bool usage_pattern_render(uint32_t *pixels, int width, int height, int style, int pixel_size, int gap,
                          int fill_width, uint32_t track_color, uint32_t fill_color);
