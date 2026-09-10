#include "display_module.h"
#include "speed_dial_layout.h"
#include <math.h>
#include <string.h>

static bool text(const cJSON *object, const char *key, char *out, size_t capacity)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (item == NULL) return true;
    if (!cJSON_IsString(item) || item->valuestring == NULL || strlen(item->valuestring) >= capacity) return false;
    memcpy(out, item->valuestring, strlen(item->valuestring) + 1);
    return true;
}

static bool integer(const cJSON *item, uint32_t max, uint32_t *out)
{
    if (!cJSON_IsNumber(item) || !isfinite(item->valuedouble) || item->valuedouble < 0 ||
        item->valuedouble > max || floor(item->valuedouble) != item->valuedouble) return false;
    *out = (uint32_t)item->valuedouble;
    return true;
}

static bool optional_bool(const cJSON *object, const char *key, bool *out)
{
    const cJSON *value = cJSON_GetObjectItemCaseSensitive(object, key);
    if (value != NULL && !cJSON_IsBool(value)) return false;
    *out = cJSON_IsTrue(value);
    return true;
}

static bool message_text(const cJSON *object, const char *key, char *out, size_t capacity)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL) return false;
    const unsigned char *source = (const unsigned char *)item->valuestring;
    size_t length = strlen(item->valuestring);
    if (length >= capacity) return false;
    for (size_t i = 0; i < length;) {
        unsigned char first = source[i++];
        if (first < 0x20 || first == 0x7f) return false;
        if (first < 0x80) continue;
        unsigned trailing;
        uint32_t codepoint;
        if (first >= 0xc2 && first <= 0xdf) { trailing = 1; codepoint = first & 0x1f; }
        else if (first >= 0xe0 && first <= 0xef) { trailing = 2; codepoint = first & 0x0f; }
        else if (first >= 0xf0 && first <= 0xf4) { trailing = 3; codepoint = first & 0x07; }
        else return false;
        if (i + trailing > length) return false;
        for (unsigned j = 0; j < trailing; ++j) {
            unsigned char next = source[i++];
            if ((next & 0xc0) != 0x80) return false;
            codepoint = (codepoint << 6) | (next & 0x3f);
        }
        if ((trailing == 2 && codepoint < 0x800) || (trailing == 3 && codepoint < 0x10000) ||
            (codepoint >= 0xd800 && codepoint <= 0xdfff) || codepoint > 0x10ffff) return false;
    }
    memcpy(out, item->valuestring, length + 1);
    return true;
}

static bool hex_id(const char *value)
{
    if (strlen(value) != 40) return false;
    for (unsigned i = 0; i < 40; ++i)
        if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f'))) return false;
    return true;
}

static bool speed_dial_fields(const cJSON *dashboard, module_snapshot_t *out)
{
    speed_dial_snapshot_t *dial = &out->speed_dial;
    const cJSON *layout = cJSON_GetObjectItemCaseSensitive(dashboard, "layout");
    const cJSON *labels = cJSON_GetObjectItemCaseSensitive(dashboard, "showLabels");
    uint32_t grid_size, list_rows;
    if (out->status != MODULE_READY || !cJSON_IsString(layout) || !layout->valuestring ||
        !cJSON_IsBool(labels) || !hex_id(out->open_token) ||
        !message_text(dashboard, "artId", out->art_id, sizeof(out->art_id)) || !hex_id(out->art_id) ||
        !integer(cJSON_GetObjectItemCaseSensitive(dashboard, "gridSize"), 6, &grid_size) ||
        !integer(cJSON_GetObjectItemCaseSensitive(dashboard, "listRows"), 4, &list_rows) ||
        (grid_size != 0 && grid_size != 4 && grid_size != 6) || (list_rows != 3 && list_rows != 4) ||
        !cJSON_GetObjectItemCaseSensitive(dashboard, "pageIndex") ||
        !cJSON_GetObjectItemCaseSensitive(dashboard, "pageCount")) return false;
    if (!strcmp(layout->valuestring, "list")) dial->list = true;
    else if (strcmp(layout->valuestring, "grid")) return false;
    dial->grid_size = grid_size;
    dial->list_rows = list_rows;
    dial->show_labels = cJSON_IsTrue(labels);
    const cJSON *shape = cJSON_GetObjectItemCaseSensitive(dashboard, "screenShape");
    if (shape) {
        if (!cJSON_IsString(shape) || !shape->valuestring) return false;
        if (!strcmp(shape->valuestring, "rectangular")) dial->rectangular = true;
        else if (strcmp(shape->valuestring, "round")) return false;
    }
    const cJSON *buttons = cJSON_GetObjectItemCaseSensitive(dashboard, "buttons");
    unsigned limit = speed_dial_layout(out, NULL);
    if (!cJSON_IsArray(buttons) || cJSON_GetArraySize(buttons) > (int)limit) return false;
    const cJSON *item;
    cJSON_ArrayForEach(item, buttons) {
        speed_dial_button_t *button = &dial->buttons[dial->count];
        const cJSON *enabled = cJSON_GetObjectItemCaseSensitive(item, "enabled");
        const cJSON *color = cJSON_GetObjectItemCaseSensitive(item, "color");
        const cJSON *status = cJSON_GetObjectItemCaseSensitive(item, "status");
        uint32_t icon;
        if (!cJSON_IsObject(item) || !message_text(item, "id", button->id, sizeof(button->id)) ||
            !button->id[0] || !message_text(item, "label", button->label, sizeof(button->label)) ||
            !cJSON_IsBool(enabled) || !color || !cJSON_IsString(status) || !status->valuestring ||
            !integer(cJSON_GetObjectItemCaseSensitive(item, "iconIndex"), SPEED_DIAL_BUTTON_LIMIT - 1, &icon)) return false;
        unsigned label_points = 0;
        for (const unsigned char *c = (const unsigned char *)button->label; *c; ++c)
            if ((*c & 0xc0) != 0x80) label_points++;
        if (label_points > 24) return false;
        for (const char *c = button->id; *c; ++c)
            if (!((*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') ||
                  (*c >= '0' && *c <= '9') || *c == '_' || *c == '-')) return false;
        for (unsigned i = 0; i < dial->count; ++i)
            if (!strcmp(button->id, dial->buttons[i].id)) return false;
        button->enabled = cJSON_IsTrue(enabled);
        button->icon_index = icon;
        if (!cJSON_IsNull(color)) {
            if (!integer(color, 0xffffff, &button->color)) return false;
            button->has_color = true;
        }
        if (!strcmp(status->valuestring, "idle")) button->status = SPEED_DIAL_IDLE;
        else if (!strcmp(status->valuestring, "running")) button->status = SPEED_DIAL_RUNNING;
        else if (!strcmp(status->valuestring, "success")) button->status = SPEED_DIAL_SUCCESS;
        else if (!strcmp(status->valuestring, "error")) button->status = SPEED_DIAL_ERROR;
        else return false;
        dial->count++;
    }
    return true;
}

static bool metric(const cJSON *item, module_metric_t *out)
{
    if (item == NULL || cJSON_IsNull(item)) return true;
    if (!cJSON_IsObject(item) || !text(item, "provider", out->provider, sizeof(out->provider)) ||
        !text(item, "label", out->label, sizeof(out->label)) ||
        !text(item, "reset", out->reset, sizeof(out->reset)) ||
        !optional_bool(item, "openable", &out->openable)) return false;
    const cJSON *remaining = cJSON_GetObjectItemCaseSensitive(item, "remaining");
    if (remaining == NULL || cJSON_IsNull(remaining)) return true;
    if (!cJSON_IsNumber(remaining) || !isfinite(remaining->valuedouble) ||
        remaining->valuedouble < 0 || remaining->valuedouble > 100) return false;
    out->available = true;
    out->remaining = (float)remaining->valuedouble;
    return true;
}

static bool clock_time(const char *value)
{
    size_t length = strlen(value);
    bool has_period = length == 6 || length == 7;
    if (!has_period && length != 4 && length != 5) return false;
    size_t colon = has_period ? length - 5 : length - 3;
    if (value[colon] != ':' || value[colon + 1] < '0' || value[colon + 1] > '5' ||
        value[colon + 2] < '0' || value[colon + 2] > '9') return false;
    unsigned hour = 0;
    for (size_t i = 0; i < colon; ++i) {
        if (value[i] < '0' || value[i] > '9') return false;
        hour = hour * 10 + (unsigned)(value[i] - '0');
    }
    if (!has_period) return hour <= 23 && (colon == 2 || hour >= 1);
    return value[0] != '0' && hour >= 1 && hour <= 12 &&
        (value[length - 2] == 'a' || value[length - 2] == 'p') && value[length - 1] == 'm';
}

static bool clock_fields(const cJSON *dashboard, module_snapshot_t *out)
{
    const cJSON *blink = cJSON_GetObjectItemCaseSensitive(dashboard, "blinkSeparator");
    if (blink != NULL && !cJSON_IsBool(blink)) return false;
    out->blink_separator = cJSON_IsTrue(blink);
    const cJSON *time = cJSON_GetObjectItemCaseSensitive(dashboard, "time");
    const cJSON *weekday = cJSON_GetObjectItemCaseSensitive(dashboard, "weekday");
    if (out->status == MODULE_READY && (time == NULL || weekday == NULL)) return false;
    if (!text(dashboard, "time", out->time, sizeof(out->time)) ||
        !text(dashboard, "weekday", out->weekday, sizeof(out->weekday))) return false;
    if (time != NULL && !clock_time(out->time)) return false;
    if (out->weekday[0] == '\0') return true;
    static const char *days[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
    for (unsigned i = 0; i < sizeof(days) / sizeof(days[0]); ++i) {
        if (strcmp(out->weekday, days[i]) == 0) return true;
    }
    return false;
}

const char *display_module_name(display_module_t kind)
{
    switch (kind) {
        case DISPLAY_USAGE: return "usage";
        case DISPLAY_HEY: return "hey";
        case DISPLAY_CLOCK: return "clock";
        case DISPLAY_ROON: return "roon";
        case DISPLAY_AUDIO: return "audio";
        case DISPLAY_SPEED_DIAL: return "speedDial";
        default: return "face";
    }
}

static bool parse_design(const cJSON *root, module_snapshot_t *out)
{
    module_design_default(out->kind, &out->design);
    const cJSON *values = cJSON_GetObjectItemCaseSensitive(root, "design");
    if (values == NULL) return true;
    unsigned length = module_design_length(out->kind);
    if (!cJSON_IsArray(values)) return false;
    unsigned received = (unsigned)cJSON_GetArraySize(values);
    // Older designs retain defaults for appended scale, progress styles or artwork motion.
    if (received != length && !(out->kind == DISPLAY_FACE && received == 8) &&
        !(out->kind == DISPLAY_USAGE && received == 25) &&
        !(out->kind == DISPLAY_ROON && received == 13)) return false;
    length = received;
    for (unsigned index = 0; index < length; ++index) {
        const cJSON *field = cJSON_GetArrayItem(values, (int)index);
        if (!cJSON_IsNumber(field) || !isfinite(field->valuedouble) ||
            field->valuedouble < INT32_MIN || field->valuedouble > INT32_MAX) return false;
        int32_t value = (int32_t)field->valuedouble;
        if (value != field->valuedouble || !module_design_valid(out->kind, index, value)) return false;
        out->design.values[index] = value;
    }
    out->has_design = true;
    return true;
}

bool display_module_parse(const cJSON *root, module_snapshot_t *out)
{
    memset(out, 0, sizeof(*out));
    out->palette = (device_palette_t){0x000000, 0xf2edfa, 0x958ca4, 0x151515, 0x2b2b2b, 0x65c18c, 0x65c18c, 0xd9be81, 0xe88483};
    const cJSON *theme = cJSON_GetObjectItemCaseSensitive(root, "theme");
    if (theme) {
        if (!cJSON_IsString(theme) || !theme->valuestring) return false;
        if (!strcmp(theme->valuestring, "light")) out->light_theme = true;
        else if (strcmp(theme->valuestring, "dark")) return false;
    }
    if (out->light_theme) out->palette = (device_palette_t){0xffffff,0x171717,0x666666,0xf0f0f0,0xdcdcdc,0x65c18c,0x65c18c,0xd9be81,0xe88483};
    const cJSON *palette = cJSON_GetObjectItemCaseSensitive(root, "palette");
    if (palette) {
        if (!cJSON_IsObject(palette)) return false;
        out->has_palette = true;
        const char *keys[] = {"background", "foreground", "muted", "surface", "track", "accent", "success", "warning", "danger"};
        uint32_t *fields[] = {&out->palette.background, &out->palette.foreground, &out->palette.muted, &out->palette.surface,
            &out->palette.track, &out->palette.accent, &out->palette.success, &out->palette.warning, &out->palette.danger};
        for (unsigned i = 0; i < 9; ++i) {
            const cJSON *value = cJSON_GetObjectItemCaseSensitive(palette, keys[i]);
            if (!integer(value, 0xffffff, fields[i])) return false;
        }
    }
    out->count = 1;
    out->page_count = 1;
    out->status = MODULE_UNAVAILABLE;
    const cJSON *kind = cJSON_GetObjectItemCaseSensitive(root, "module");
    if (kind != NULL) {
        if (!cJSON_IsString(kind) || kind->valuestring == NULL) return false;
        if (strcmp(kind->valuestring, "face") == 0) out->kind = DISPLAY_FACE;
        else if (strcmp(kind->valuestring, "usage") == 0) out->kind = DISPLAY_USAGE;
        else if (strcmp(kind->valuestring, "hey") == 0) out->kind = DISPLAY_HEY;
        else if (strcmp(kind->valuestring, "clock") == 0) out->kind = DISPLAY_CLOCK;
        else if (strcmp(kind->valuestring, "roon") == 0) out->kind = DISPLAY_ROON;
        else if (strcmp(kind->valuestring, "audio") == 0) out->kind = DISPLAY_AUDIO;
        else if (strcmp(kind->valuestring, "speedDial") == 0) out->kind = DISPLAY_SPEED_DIAL;
        else return false;
    }
    if (!parse_design(root, out)) return false;
    const cJSON *index = cJSON_GetObjectItemCaseSensitive(root, "moduleIndex");
    const cJSON *count = cJSON_GetObjectItemCaseSensitive(root, "moduleCount");
    if (index != NULL || count != NULL) {
        uint32_t parsed_index, parsed_count;
        if (!integer(index, MODULE_LIMIT - 1, &parsed_index) || !integer(count, MODULE_LIMIT, &parsed_count) ||
            parsed_count == 0 || parsed_index >= parsed_count) return false;
        out->index = (uint8_t)parsed_index;
        out->count = (uint8_t)parsed_count;
    }
    const cJSON *navigation = cJSON_GetObjectItemCaseSensitive(root, "showModuleNavigation");
    if (navigation != NULL && !cJSON_IsBool(navigation)) return false;
    out->show_navigation = cJSON_IsTrue(navigation);
    const cJSON *backgrounds = cJSON_GetObjectItemCaseSensitive(root, "showCardBackgrounds");
    if (backgrounds != NULL && !cJSON_IsBool(backgrounds)) return false;
    out->show_card_backgrounds = cJSON_IsTrue(backgrounds);
    const cJSON *dashboard = cJSON_GetObjectItemCaseSensitive(root, "dashboard");
    if (dashboard == NULL) return true;
    if (!cJSON_IsObject(dashboard)) return false;
    const cJSON *open_token = cJSON_GetObjectItemCaseSensitive(dashboard, "openToken");
    if (open_token != NULL) {
        if (!text(dashboard, "openToken", out->open_token, sizeof(out->open_token)) || strlen(out->open_token) != 40) return false;
        for (unsigned i = 0; i < 40; ++i)
            if (!((out->open_token[i] >= '0' && out->open_token[i] <= '9') || (out->open_token[i] >= 'a' && out->open_token[i] <= 'f'))) return false;
    }
    const cJSON *refreshing = cJSON_GetObjectItemCaseSensitive(dashboard, "refreshing");
    if (refreshing != NULL && !cJSON_IsBool(refreshing)) return false;
    out->refreshing = cJSON_IsTrue(refreshing);
    const cJSON *page_index = cJSON_GetObjectItemCaseSensitive(dashboard, "pageIndex");
    const cJSON *page_count = cJSON_GetObjectItemCaseSensitive(dashboard, "pageCount");
    if (page_index != NULL || page_count != NULL) {
        uint32_t parsed_index, parsed_count;
        if (!integer(page_index, 255, &parsed_index) || !integer(page_count, 256, &parsed_count) ||
            parsed_count == 0 || parsed_index >= parsed_count) return false;
        out->page_index = (uint16_t)parsed_index;
        out->page_count = (uint16_t)parsed_count;
    }
    const cJSON *status = cJSON_GetObjectItemCaseSensitive(dashboard, "status");
    if (!cJSON_IsString(status) || status->valuestring == NULL) return false;
    static const char *statuses[] = {"ready", "loading", "unavailable", "auth", "error"};
    bool found = false;
    for (unsigned i = 0; i < sizeof(statuses) / sizeof(statuses[0]); ++i) {
        if (strcmp(statuses[i], status->valuestring) == 0) {
            out->status = (module_status_t)i;
            found = true;
            break;
        }
    }
    if (!found || !text(dashboard, "title", out->title, sizeof(out->title)) ||
        !text(dashboard, "detail", out->detail, sizeof(out->detail)) ||
        !metric(cJSON_GetObjectItemCaseSensitive(dashboard, "primary"), &out->primary) ||
        !metric(cJSON_GetObjectItemCaseSensitive(dashboard, "secondary"), &out->secondary)) return false;
    if (out->kind == DISPLAY_SPEED_DIAL && !speed_dial_fields(dashboard, out)) return false;
    if (out->kind == DISPLAY_CLOCK && !clock_fields(dashboard, out)) return false;
    if (out->kind == DISPLAY_AUDIO) {
        const cJSON *scope = cJSON_GetObjectItemCaseSensitive(dashboard, "scope");
        if (!cJSON_IsString(scope) || !scope->valuestring) return false;
        if (!strcmp(scope->valuestring, "input")) out->audio_input = true;
        else if (strcmp(scope->valuestring, "output")) return false;
        if (!optional_bool(dashboard, "pickerOpen", &out->audio_picker_open)) return false;
        if (!integer(cJSON_GetObjectItemCaseSensitive(dashboard, "deviceId"), UINT32_MAX, &out->audio_device_id) ||
            !message_text(dashboard, "deviceName", out->audio_device_name, sizeof(out->audio_device_name)) ||
            (!out->audio_picker_open && (out->page_count != 2 || out->page_index != (out->audio_input ? 1 : 0)))) return false;
        const cJSON *devices = cJSON_GetObjectItemCaseSensitive(dashboard, "devices");
        if (devices) {
            if (!cJSON_IsArray(devices) || cJSON_GetArraySize(devices) > 3) return false;
            out->audio_row_count = cJSON_GetArraySize(devices);
            for (unsigned i = 0; i < out->audio_row_count; ++i) {
                const cJSON *device = cJSON_GetArrayItem(devices, i);
                const cJSON *active = cJSON_GetObjectItemCaseSensitive(device, "active");
                if (!cJSON_IsObject(device) || !integer(cJSON_GetObjectItemCaseSensitive(device, "id"), UINT32_MAX, &out->audio_devices[i].id) ||
                    !out->audio_devices[i].id || !message_text(device, "name", out->audio_devices[i].name, sizeof(out->audio_devices[i].name)) || !cJSON_IsBool(active)) return false;
                out->audio_devices[i].active = cJSON_IsTrue(active);
                for (unsigned j = 0; j < i; ++j) if (out->audio_devices[j].id == out->audio_devices[i].id) return false;
            }
        } else if (out->audio_picker_open) return false;
        const cJSON *next_device = cJSON_GetObjectItemCaseSensitive(dashboard, "nextDeviceId");
        const cJSON *device_count = cJSON_GetObjectItemCaseSensitive(dashboard, "deviceCount");
        if ((next_device && !integer(next_device, UINT32_MAX, &out->audio_next_device_id)) ||
            (device_count && !integer(device_count, UINT32_MAX, &out->audio_device_count))) return false;
        const cJSON *volume = cJSON_GetObjectItemCaseSensitive(dashboard, "volume");
        const cJSON *muted = cJSON_GetObjectItemCaseSensitive(dashboard, "muted");
        const cJSON *can_volume = cJSON_GetObjectItemCaseSensitive(dashboard, "canVolume");
        const cJSON *can_mute = cJSON_GetObjectItemCaseSensitive(dashboard, "canMute");
        if (!volume || !muted || !cJSON_IsBool(can_volume) || !cJSON_IsBool(can_mute)) return false;
        if (!cJSON_IsNull(volume)) {
            if (!cJSON_IsNumber(volume) || !isfinite(volume->valuedouble) || volume->valuedouble < 0 || volume->valuedouble > 100) return false;
            out->audio_has_volume = true; out->audio_volume = volume->valuedouble;
        }
        if (!cJSON_IsNull(muted)) {
            if (!cJSON_IsBool(muted)) return false;
            out->audio_has_mute = true; out->audio_muted = cJSON_IsTrue(muted);
        }
        out->audio_can_volume = cJSON_IsTrue(can_volume) && out->audio_has_volume;
        out->audio_can_mute = cJSON_IsTrue(can_mute) && out->audio_has_mute;
    }
    if (out->kind == DISPLAY_ROON) {
        const cJSON *player = cJSON_GetObjectItemCaseSensitive(dashboard, "player");
        if (player) {
            if (!cJSON_IsString(player) || !player->valuestring) return false;
            if (!strcmp(player->valuestring, "roon")) out->player = MUSIC_ROON;
            else if (!strcmp(player->valuestring, "spotify")) out->player = MUSIC_SPOTIFY;
            else if (!strcmp(player->valuestring, "system")) out->player = MUSIC_SYSTEM;
            else if (!strcmp(player->valuestring, "appleMusic")) out->player = MUSIC_APPLE_MUSIC;
            else return false;
        }
        if (!optional_bool(dashboard, "canLike", &out->can_like) ||
            !optional_bool(dashboard, "liked", &out->liked)) return false;
        const cJSON *expanded = cJSON_GetObjectItemCaseSensitive(dashboard, "expanded");
        if (expanded != NULL && !cJSON_IsBool(expanded)) return false;
        out->expanded = cJSON_IsTrue(expanded);
    }
    if (out->kind == DISPLAY_ROON && out->status == MODULE_READY) {
        if (!message_text(dashboard, "track", out->track, sizeof(out->track)) ||
            !message_text(dashboard, "artist", out->artist, sizeof(out->artist)) ||
            !message_text(dashboard, "artId", out->art_id, sizeof(out->art_id))) return false;
        if (out->art_id[0]) {
            if (strlen(out->art_id) != 40) return false;
            for (unsigned i = 0; i < 40; ++i)
                if (!((out->art_id[i] >= '0' && out->art_id[i] <= '9') || (out->art_id[i] >= 'a' && out->art_id[i] <= 'f'))) return false;
        }
        const cJSON *playing = cJSON_GetObjectItemCaseSensitive(dashboard, "playing");
        const cJSON *previous = cJSON_GetObjectItemCaseSensitive(dashboard, "canPrevious");
        const cJSON *next = cJSON_GetObjectItemCaseSensitive(dashboard, "canNext");
        if (!cJSON_IsBool(playing) || !cJSON_IsBool(previous) || !cJSON_IsBool(next)) return false;
        out->playing = cJSON_IsTrue(playing); out->can_previous = cJSON_IsTrue(previous); out->can_next = cJSON_IsTrue(next);
    }
    const cJSON *more = cJSON_GetObjectItemCaseSensitive(dashboard, "countMore");
    if (more != NULL && !cJSON_IsBool(more)) return false;
    out->count_more = cJSON_IsTrue(more);
    const cJSON *total = cJSON_GetObjectItemCaseSensitive(dashboard, "count");
    if (total != NULL && !cJSON_IsNull(total)) {
        if (!integer(total, 999999, &out->total)) return false;
        out->has_count = true;
    }
    const cJSON *items = cJSON_GetObjectItemCaseSensitive(dashboard, "items");
    if (items != NULL) {
        if (!cJSON_IsArray(items) || cJSON_GetArraySize(items) > MODULE_MESSAGE_LIMIT) return false;
        const cJSON *item;
        cJSON_ArrayForEach(item, items) {
            module_message_t *parsed = &out->messages[out->message_count];
            if (!cJSON_IsObject(item) ||
                !message_text(item, "sender", parsed->sender, sizeof(parsed->sender)) ||
                !message_text(item, "subject", parsed->subject, sizeof(parsed->subject)) ||
                !optional_bool(item, "openable", &parsed->openable)) return false;
            out->message_count++;
        }
    }
    const cJSON *boxes = cJSON_GetObjectItemCaseSensitive(dashboard, "boxes");
    if (boxes == NULL) return true;
    if (!cJSON_IsArray(boxes) || cJSON_GetArraySize(boxes) > MODULE_BOX_LIMIT) return false;
    const cJSON *box;
    cJSON_ArrayForEach(box, boxes) {
        module_box_t *parsed = &out->boxes[out->box_count++];
        if (!cJSON_IsObject(box) || !text(box, "label", parsed->label, sizeof(parsed->label))) return false;
        const cJSON *value = cJSON_GetObjectItemCaseSensitive(box, "count");
        if (value != NULL && !cJSON_IsNull(value)) {
            if (!integer(value, 999999, &parsed->count)) return false;
            parsed->available = true;
        }
    }
    return true;
}
