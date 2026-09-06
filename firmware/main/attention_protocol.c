#include "attention_protocol.h"
#include <math.h>
#include <ctype.h>
#include <string.h>

static bool text(const cJSON *object, const char *key, char *out, size_t size, unsigned max_chars, bool token)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (!cJSON_IsString(item) || !item->valuestring) return false;
    const unsigned char *value = (const unsigned char *)item->valuestring;
    size_t bytes = strlen((const char *)value);
    if (bytes >= size) return false;
    unsigned chars = 0;
    for (size_t i = 0; i < bytes; ++i) {
        if ((value[i] & 0xc0) != 0x80) ++chars;
        if (token && !(isalnum(value[i]) || value[i] == '-' || value[i] == '_')) return false;
    }
    if (chars > max_chars || (token && !bytes)) return false;
    memcpy(out, value, bytes + 1);
    return true;
}

bool attention_parse(const cJSON *root, attention_snapshot_t *out)
{
    memset(out, 0, sizeof(*out));
    const cJSON *a = cJSON_GetObjectItemCaseSensitive(root, "attention");
    if (!a || cJSON_IsNull(a)) return true;
    if (!cJSON_IsObject(a) || !text(a, "id", out->id, sizeof(out->id), 36, true)) return false;
    const cJSON *revision = cJSON_GetObjectItemCaseSensitive(a, "revision");
    const cJSON *detail = cJSON_GetObjectItemCaseSensitive(a, "detail");
    const cJSON *actions = cJSON_GetObjectItemCaseSensitive(a, "actions");
    if (!cJSON_IsNumber(revision) || !isfinite(revision->valuedouble) || revision->valuedouble < 1 ||
        revision->valuedouble > UINT32_MAX || floor(revision->valuedouble) != revision->valuedouble ||
        !cJSON_IsBool(detail) || !cJSON_IsArray(actions)) return false;
    int count = cJSON_GetArraySize(actions);
    if (count < 1 || count > 2 || !text(a, "body", out->body, sizeof(out->body), 480, false)) return false;
    for (int i = 0; i < count; ++i) {
        const cJSON *button = cJSON_GetArrayItem(actions, i);
        if (!text(button, "id", out->actions[i].id, sizeof(out->actions[i].id), 32, true) ||
            !text(button, "label", out->actions[i].label, sizeof(out->actions[i].label), 16, false) ||
            !out->actions[i].label[0] || !strcmp(out->actions[i].id, "__dismiss") || !strcmp(out->actions[i].id, "open") || !strcmp(out->actions[i].id, "back")) return false;
    }
    if (count == 2 && !strcmp(out->actions[0].id, out->actions[1].id)) return false;
    out->active = true;
    out->detail = cJSON_IsTrue(detail);
    out->revision = (uint32_t)revision->valuedouble;
    out->count = (unsigned)count;
    return true;
}

