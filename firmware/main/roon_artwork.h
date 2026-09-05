#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "cJSON.h"

#define ROON_ART_SIDE 160
#define ROON_ART_BYTES (ROON_ART_SIDE * ROON_ART_SIDE * 2)
#define ROON_ART_CHUNK 768
#define ROON_ART_ID_CAPACITY 41

typedef struct {
    uint8_t *staging, *pixels;
    char pending_id[ROON_ART_ID_CAPACITY], id[ROON_ART_ID_CAPACITY];
    uint32_t transfer, committed_transfer, offset, crc32, revision;
    bool active;
} roon_artwork_t;
typedef struct { uint32_t transfer, offset; const char *op; bool ok; } roon_art_ack_t;

bool roon_art_id_valid(const char *id, bool allow_empty);
uint32_t roon_art_crc32(const uint8_t *data, size_t length);
// Buffers are fixed-size and owned by the caller. Call under the shared state lock.
void roon_artwork_init(roon_artwork_t *art, uint8_t *staging, uint8_t *pixels);
bool roon_artwork_handle(roon_artwork_t *art, const cJSON *root, roon_art_ack_t *ack);
