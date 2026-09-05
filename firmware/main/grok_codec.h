#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// Applies an RGB565 delta stream (see scripts/grok-codec.mjs for the format) to
// `pixels`, which must already hold the previous frame (or black for a keyframe).
// Returns false on any malformed stream: truncated command, pixel overrun or
// underrun, zero or out-of-range copy distance, trailing bytes. Never reads or
// writes outside data[0..length) and pixels[0..count); on failure the buffer may
// be partially updated, so the caller should reset or stop the animation.
bool grok_decode(const uint8_t *data, size_t length, uint16_t *pixels, size_t count);
