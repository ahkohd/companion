#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "roon_artwork.h"

typedef struct { uint32_t before; uint8_t bytes[ROON_ART_BYTES]; uint32_t after; } guarded_t;
static guarded_t staging = { .before = 0x12345678, .after = 0x87654321 };
static guarded_t pixels = { .before = 0x12345678, .after = 0x87654321 };
int main(void)
{
    roon_artwork_t art;
    roon_artwork_init(&art, staging.bytes, pixels.bytes);
    char line[4096];
    while (fgets(line, sizeof(line), stdin)) {
        cJSON *root = cJSON_Parse(line);
        roon_art_ack_t ack;
        bool handled = strlen(line) <= 2048 && roon_artwork_handle(&art, root, &ack);
        if (!handled) puts("null");
        else printf("{\"type\":\"artAck\",\"v\":1,\"transfer\":%u,\"op\":\"%s\",\"ok\":%s,\"offset\":%u,\"id\":\"%s\",\"crc32\":%u,\"revision\":%u,\"active\":%s}\n",
            ack.transfer, ack.op, ack.ok ? "true" : "false", ack.offset, art.id,
            roon_art_crc32(art.pixels, ROON_ART_BYTES), art.revision, art.active ? "true" : "false");
        cJSON_Delete(root);
        assert(staging.before == 0x12345678 && staging.after == 0x87654321);
        assert(pixels.before == 0x12345678 && pixels.after == 0x87654321);
        assert(art.offset <= ROON_ART_BYTES);
    }
}
