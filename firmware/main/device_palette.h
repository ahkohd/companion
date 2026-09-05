#pragma once
#include <stdint.h>
static inline uint16_t device_rgb565(uint32_t color) {
    return (uint16_t)(((color >> 19) << 11) | (((color >> 10) & 63) << 5) | ((color >> 3) & 31));
}
// Neutral face clip pixels are coverage over black, not album artwork.
static inline uint16_t device_face_pixel(uint16_t pixel, uint32_t background, uint32_t foreground) {
    unsigned r = (pixel >> 11) & 31, g = (pixel >> 5) & 63, b = pixel & 31;
    if (r != b || (g >> 1) != r) return pixel;
    unsigned coverage = (g << 2) | (g >> 4);
    unsigned rr = (((background >> 16) * (255 - coverage)) + (foreground >> 16) * coverage + 127) / 255;
    unsigned gg = ((((background >> 8) & 255) * (255 - coverage)) + ((foreground >> 8) & 255) * coverage + 127) / 255;
    unsigned bb = (((background & 255) * (255 - coverage)) + (foreground & 255) * coverage + 127) / 255;
    return device_rgb565((rr << 16) | (gg << 8) | bb);
}
