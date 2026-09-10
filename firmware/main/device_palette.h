#pragma once
#include <stdint.h>
static inline uint16_t device_rgb565(uint32_t color) {
    return (uint16_t)(((color >> 19) << 11) | (((color >> 10) & 63) << 5) | ((color >> 3) & 31));
}
