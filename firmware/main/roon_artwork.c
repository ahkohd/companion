#include "roon_artwork.h"
#include <math.h>
#include <string.h>

bool roon_art_id_valid(const char *id, bool allow_empty)
{
    if (!id) return false;
    if (allow_empty && !id[0]) return true;
    if (strlen(id) != 40) return false;
    for (unsigned i = 0; i < 40; ++i)
        if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f'))) return false;
    return true;
}

uint32_t roon_art_crc32(const uint8_t *data, size_t length)
{
    uint32_t crc = UINT32_MAX;
    for (size_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (unsigned bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
    }
    return ~crc;
}

static bool number(const cJSON *root, const char *key, uint32_t max, uint32_t *out)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(root, key);
    if (!cJSON_IsNumber(item) || !isfinite(item->valuedouble) || item->valuedouble < 0 ||
        item->valuedouble > max || floor(item->valuedouble) != item->valuedouble) return false;
    *out = (uint32_t)item->valuedouble;
    return true;
}

static int base64_value(char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    return c == '+' ? 62 : c == '/' ? 63 : -1;
}

static size_t decode(const char *data, uint8_t *bytes)
{
    size_t length = strlen(data), count = 0;
    if (!length || length > ROON_ART_CHUNK / 3 * 4 || length % 4) return 0;
    for (size_t i = 0; i < length; i += 4) {
        int a = base64_value(data[i]), b = base64_value(data[i + 1]);
        int c = data[i + 2] == '=' ? 0 : base64_value(data[i + 2]);
        int d = data[i + 3] == '=' ? 0 : base64_value(data[i + 3]);
        bool last = i + 4 == length, pad2 = data[i + 2] == '=', pad1 = data[i + 3] == '=';
        if (a < 0 || b < 0 || c < 0 || d < 0 || (pad2 && !pad1) ||
            ((pad2 || pad1) && !last) || (pad2 && (b & 15)) || (pad1 && !pad2 && (c & 3))) return 0;
        bytes[count++] = (uint8_t)((a << 2) | (b >> 4));
        if (!pad2) bytes[count++] = (uint8_t)((b << 4) | (c >> 2));
        if (!pad1) bytes[count++] = (uint8_t)((c << 6) | d);
    }
    return count;
}

void roon_artwork_init(roon_artwork_t *art, uint8_t *staging, uint8_t *pixels)
{
    *art = (roon_artwork_t){ .staging = staging, .pixels = pixels };
}

bool roon_artwork_handle(roon_artwork_t *art, const cJSON *root, roon_art_ack_t *ack)
{
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    const cJSON *operation = cJSON_GetObjectItemCaseSensitive(root, "op");
    uint32_t version, transfer;
    if (!cJSON_IsString(type) || strcmp(type->valuestring, "art") ||
        !number(root, "v", 1, &version) || version != 1 ||
        !number(root, "transfer", UINT32_MAX, &transfer) || !transfer || !cJSON_IsString(operation)) return false;
    const char *op = operation->valuestring;
    if (strcmp(op, "begin") && strcmp(op, "chunk") && strcmp(op, "commit") && strcmp(op, "cancel")) return false;
    // Reply strings outlive the parsed JSON document.
    *ack = (roon_art_ack_t){ .transfer = transfer, .offset = art->offset,
        .op = !strcmp(op, "begin") ? "begin" : !strcmp(op, "chunk") ? "chunk" : !strcmp(op, "commit") ? "commit" : "cancel" };
    if (!art->staging || !art->pixels) return true;
    if (!strcmp(op, "begin")) {
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(root, "id");
        uint32_t width, height, crc;
        if (!cJSON_IsString(id) || !roon_art_id_valid(id->valuestring, false) ||
            !number(root, "width", ROON_ART_SIDE, &width) || width != ROON_ART_SIDE ||
            !number(root, "height", ROON_ART_SIDE, &height) || height != ROON_ART_SIDE ||
            !number(root, "crc32", UINT32_MAX, &crc)) return true;
        if (!(art->active && art->transfer == transfer && art->crc32 == crc && !strcmp(art->pending_id, id->valuestring))) {
            art->active = true; art->transfer = transfer; art->offset = 0; art->crc32 = crc;
            memcpy(art->pending_id, id->valuestring, sizeof(art->pending_id));
        }
        ack->ok = true; ack->offset = art->offset;
    } else if (!strcmp(op, "cancel")) {
        if (art->active ? transfer != art->transfer : transfer != art->committed_transfer) return true;
        art->active = false; art->offset = 0; art->id[0] = '\0'; art->revision++;
        ack->ok = true; ack->offset = 0;
    } else if (!strcmp(op, "commit") && !art->active && transfer == art->committed_transfer && art->id[0]) {
        ack->ok = true; ack->offset = ROON_ART_BYTES;
    } else if (art->active && art->transfer == transfer) {
        if (!strcmp(op, "chunk")) {
            const cJSON *data = cJSON_GetObjectItemCaseSensitive(root, "data");
            uint32_t offset;
            uint8_t bytes[ROON_ART_CHUNK];
            if (!cJSON_IsString(data) || !number(root, "offset", ROON_ART_BYTES, &offset)) return true;
            size_t length = decode(data->valuestring, bytes);
            if (!length || length > ROON_ART_BYTES - offset) return true;
            if (offset == art->offset) { memcpy(art->staging + offset, bytes, length); art->offset += length; }
            else if (offset > art->offset || length > art->offset - offset || memcmp(art->staging + offset, bytes, length)) return true;
            ack->ok = true; ack->offset = art->offset;
        } else if (!strcmp(op, "commit") && art->offset == ROON_ART_BYTES &&
                   roon_art_crc32(art->staging, ROON_ART_BYTES) == art->crc32) {
            memcpy(art->pixels, art->staging, ROON_ART_BYTES);
            memcpy(art->id, art->pending_id, sizeof(art->id));
            art->committed_transfer = transfer; art->active = false; art->revision++;
            ack->ok = true;
        }
    }
    return true;
}
