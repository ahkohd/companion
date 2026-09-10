#include <assert.h>
#include <inttypes.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include "esp_log.h"
#include "esp_attr.h"
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "board.h"
#include "driver/usb_serial_jtag.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_psram.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lvgl.h"

/* Module layout and rotation still use the original logical canvas. A new
 * geometry must port those paths before it can claim working firmware. */
_Static_assert(COMPANION_DISPLAY_WIDTH == 466 && COMPANION_DISPLAY_HEIGHT == 466,
    "Port module layout and screen rotation before using a different canvas");

#define FRAME_MAX 4096
#define FACE_LABEL_CAPACITY 97
#define FACE_NAME_CAPACITY 193
#include "face_model.h"
#include "face_shimmer.h"
#include "fonts/geist.h"
#include "design_fonts.h"
#include "display_module.h"
#include "module_view.h"
#include "module_touch.h"
#include "attention_view.h"
#include "attention_gesture.h"
#include "roon_artwork.h"
#include "screen_rotation.h"

#define DISCONNECT_US (8LL * 1000 * 1000)
#define READY_PERIOD_US (2LL * 1000 * 1000)
#define IDLE_SLEEP_US (30LL * 1000 * 1000)
// Fixed even-width buffers keep RGB565 rows tightly packed at every designer width.
#define SHIMMER_MASK_W 420
#define SHIMMER_MASK_H 60
// Status text sits text_gap px above the session name (name_label top stays at NAME_TOP).
// Source of truth for the gap options: shared/display-layout.json (4 close, 8 balanced, 16 wide).
#define NAME_TOP 395
#define NAME_MASK_W 380
#define NAME_MASK_H 60
#define TEXT_GAP_DEFAULT 8

static const char CYCLE_JSON[] = "{\"type\":\"cycle\",\"v\":1}\n";

typedef struct {
    face_state_t state;
    face_state_t expression;
    bool has_expression;
    module_snapshot_t module;
    attention_snapshot_t attention;
    uint32_t seq;
    uint16_t counts[5];
    char label[FACE_LABEL_CAPACITY];
    char name[FACE_NAME_CAPACITY];
    int64_t last_valid_us;
    int64_t state_since_us;
    uint32_t revision;
    bool ever_received;
    bool preview;
    bool status_dots;
    bool name_shimmer;
    bool has_look;
    float look_x;
    float look_y;
    double animation_ms;
    uint32_t age_ms;
    bool has_timing;
    bool has_epoch;
    uint32_t epoch;
    int text_gap;
    unsigned rotation;
} status_snapshot_t;

static SemaphoreHandle_t state_mutex;
static QueueHandle_t cycle_queue;
static attention_gesture_t attention_gesture;
static uint32_t attention_touch_revision;
typedef struct { int8_t action; music_player_t player; bool audio_input, audio_muted; uint32_t audio_device_id, audio_target_device_id; float audio_volume; module_card_target_t card; char speed_dial_id[SPEED_DIAL_ID_CAPACITY], speed_dial_token[41]; char attention_id[37], attention_action[33]; uint32_t attention_revision; } touch_message_t;
static roon_artwork_t roon_artwork;
static uint32_t shown_art_revision;
static status_snapshot_t shared_status = {
    .state = FACE_DISCONNECTED,
    .module = {.kind = DISPLAY_FACE, .count = 1, .status = MODULE_UNAVAILABLE,
        .palette = {0,0xf2edfa,0x958ca4,0x151515,0x2b2b2b,0x65c18c,0x65c18c,0xd9be81,0xe88483}},
    .label = "Disconnected",
    .name = "Waiting for host",
    .text_gap = TEXT_GAP_DEFAULT,
};

static lv_obj_t *face_canvas;
static uint16_t *face_pixels;
static face_motion_t motion;
static face_eye_t rendered_eyes[2];
static uint32_t rendered_seq;
static uint32_t render_us;
static int rendered_shimmer_pixels;
static int rendered_name_shimmer_pixels;
static int rendered_text_gap = TEXT_GAP_DEFAULT;
static int rendered_status_top = NAME_TOP - 27 - TEXT_GAP_DEFAULT;
static display_module_t rendered_module = DISPLAY_FACE;
static bool rendered_light_theme;
static uint16_t rendered_page_index, rendered_page_count = 1;
static bool rendered_refreshing;
static bool rendered_font_error;
static unsigned rendered_rotation;
static uint32_t display_rotation_revision;
static lv_obj_t *shimmer_canvas;
static uint16_t *shimmer_mask;
static lv_obj_t *name_shimmer_canvas;
static uint16_t *name_shimmer_mask;
static double last_animation_time;
static lv_obj_t *status_label;
static lv_obj_t *name_label;
static uint32_t shown_revision = UINT32_MAX;
static face_state_t shown_state = FACE_DISCONNECTED;

static bool json_uint(const cJSON *object, const char *key, uint32_t max, uint32_t *out)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (!cJSON_IsNumber(item) || !isfinite(item->valuedouble) || item->valuedouble < 0 || item->valuedouble > max) {
        return false;
    }
    uint32_t value = (uint32_t)item->valuedouble;
    if ((double)value != item->valuedouble) {
        return false;
    }
    *out = value;
    return true;
}

static bool json_text(const cJSON *object, const char *key, char *out, size_t capacity)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(object, key);
    if (!cJSON_IsString(item) || item->valuestring == NULL) {
        return false;
    }
    size_t length = strlen(item->valuestring);
    if (length >= capacity) {
        return false;
    }
    memcpy(out, item->valuestring, length + 1);
    return true;
}

static bool text_gap_valid(int gap)
{
    return gap == 4 || gap == 8 || gap == 16;
}

static int status_top_for_gap(int gap)
{
    return NAME_TOP - lv_font_geist_22.line_height - gap;
}

static bool parse_face_state(const char *value, face_state_t *state)
{
    static const struct {
        const char *name;
        face_state_t state;
    } states[] = {
        {"working", FACE_WORKING},
        {"blocked", FACE_BLOCKED},
        {"done", FACE_DONE},
        {"idle", FACE_IDLE},
        {"sleep", FACE_SLEEP},
        {"unknown", FACE_UNKNOWN},
        {"disconnected", FACE_DISCONNECTED},
    };

    for (size_t i = 0; i < sizeof(states) / sizeof(states[0]); ++i) {
        if (strcmp(value, states[i].name) == 0) {
            *state = states[i].state;
            return true;
        }
    }
    return false;
}

static bool frame_has_null_escape(const char *line, size_t length)
{
    for (size_t i = 0; i + 1 < length; ++i) {
        if (line[i] != '\\') continue;
        if (i + 5 < length && !memcmp(line + i + 1, "u0000", 5)) return true;
        i++;
    }
    return false;
}

static bool parse_state_frame(const char *line, size_t length, status_snapshot_t *parsed)
{
    if (length == 0 || length > FRAME_MAX || memchr(line, '\0', length) != NULL || frame_has_null_escape(line, length)) {
        return false;
    }

    const char *parse_end = NULL;
    cJSON *root = cJSON_ParseWithLengthOpts(line, length + 1, &parse_end, true);
    if (!cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return false;
    }

    bool valid = false;
    if (!attention_parse(root, &parsed->attention)) { cJSON_Delete(root); return false; }
    char type[8];
    char state_name[16];
    uint32_t version;
    uint32_t counts[5];
    static const char *count_names[] = {"working", "blocked", "done", "idle", "unknown"};
    const cJSON *counts_object = cJSON_GetObjectItemCaseSensitive(root, "counts");
    const cJSON *preview = cJSON_GetObjectItemCaseSensitive(root, "preview");
    if (preview != NULL && !cJSON_IsBool(preview)) {
        goto done;
    }
    parsed->preview = cJSON_IsTrue(preview);
    parsed->rotation = 0;
    if (cJSON_GetObjectItemCaseSensitive(root, "rotation") != NULL) {
        uint32_t rotation;
        if (!json_uint(root, "rotation", 359, &rotation)) goto done;
        parsed->rotation = rotation;
    }
    const cJSON *status_dots = cJSON_GetObjectItemCaseSensitive(root, "statusDots");
    if (status_dots != NULL && !cJSON_IsBool(status_dots)) goto done;
    parsed->status_dots = cJSON_IsTrue(status_dots);
    const cJSON *name_shimmer = cJSON_GetObjectItemCaseSensitive(root, "nameShimmer");
    if (name_shimmer != NULL && !cJSON_IsBool(name_shimmer)) goto done;
    parsed->name_shimmer = cJSON_IsTrue(name_shimmer);
    const cJSON *legacy_animation = cJSON_GetObjectItemCaseSensitive(root, "animation");
    if (legacy_animation != NULL && !cJSON_IsNull(legacy_animation)) goto done;
    const cJSON *expression = cJSON_GetObjectItemCaseSensitive(root, "expression");
    parsed->has_expression = expression != NULL && !cJSON_IsNull(expression);
    if (parsed->has_expression && (!cJSON_IsString(expression) ||
        !parse_face_state(expression->valuestring, &parsed->expression))) goto done;
    if (!display_module_parse(root, &parsed->module)) goto done;
    const cJSON *text_gap = cJSON_GetObjectItemCaseSensitive(root, "textGap");
    parsed->text_gap = TEXT_GAP_DEFAULT;
    if (text_gap != NULL) {
        uint32_t gap;
        if (!json_uint(root, "textGap", 16, &gap) || !text_gap_valid((int)gap)) goto done;
        parsed->text_gap = (int)gap;
    }
    parsed->has_epoch = cJSON_GetObjectItemCaseSensitive(root, "epoch") != NULL;
    if (parsed->has_epoch && !json_uint(root,"epoch",UINT32_MAX,&parsed->epoch)) goto done;
    const cJSON *animation = cJSON_GetObjectItemCaseSensitive(root, "animationMs");
    const cJSON *age = cJSON_GetObjectItemCaseSensitive(root, "ageMs");
    parsed->has_timing = animation != NULL || age != NULL;
    if (parsed->has_timing) {
        if (!cJSON_IsNumber(animation) || !isfinite(animation->valuedouble) ||
            animation->valuedouble < 0 || animation->valuedouble > 1e12 ||
            !json_uint(root, "ageMs", UINT32_MAX, &parsed->age_ms)) goto done;
        parsed->animation_ms = animation->valuedouble;
    }
    const cJSON *look = cJSON_GetObjectItemCaseSensitive(root, "look");
    parsed->has_look = false;
    parsed->look_x = parsed->look_y = 0;
    if (look != NULL && !cJSON_IsNull(look)) {
        const cJSON *x = cJSON_GetObjectItemCaseSensitive(look, "x");
        const cJSON *y = cJSON_GetObjectItemCaseSensitive(look, "y");
        if (!cJSON_IsObject(look) || !cJSON_IsNumber(x) || !cJSON_IsNumber(y) ||
            !isfinite(x->valuedouble) || !isfinite(y->valuedouble) ||
            fabs(x->valuedouble) > 1 || fabs(y->valuedouble) > 1) {
            goto done;
        }
        parsed->has_look = true;
        parsed->look_x = (float)x->valuedouble;
        parsed->look_y = (float)y->valuedouble;
    }

    if (!json_text(root, "type", type, sizeof(type)) || strcmp(type, "state") != 0 ||
        !json_uint(root, "v", 1, &version) || version != 1 ||
        !json_uint(root, "seq", UINT32_MAX, &parsed->seq) ||
        !json_text(root, "state", state_name, sizeof(state_name)) ||
        !parse_face_state(state_name, &parsed->state) ||
        !json_text(root, "label", parsed->label, sizeof(parsed->label)) ||
        !json_text(root, "name", parsed->name, sizeof(parsed->name)) ||
        !cJSON_IsObject(counts_object)) {
        goto done;
    }

    if (parsed->status_dots && (parsed->preview || parsed->state != FACE_WORKING)) goto done;
    for (size_t i = 0; i < sizeof(count_names) / sizeof(count_names[0]); ++i) {
        if (!json_uint(counts_object, count_names[i], UINT16_MAX, &counts[i])) {
            goto done;
        }
        parsed->counts[i] = (uint16_t)counts[i];
    }
    valid = true;

done:
    cJSON_Delete(root);
    return valid;
}

static bool name_shimmer_enabled(const status_snapshot_t *status, bool disconnected)
{
    return status->module.kind == DISPLAY_FACE && !disconnected && status->state != FACE_DISCONNECTED &&
        !status->preview && status->name_shimmer && status->name[0];
}

static void protocol_self_check(void)
{
    static const char valid[] =
        "{\"type\":\"state\",\"v\":1,\"seq\":7,\"state\":\"working\","
        "\"label\":\"3 working\",\"name\":\"All agents\",\"counts\":{"
        "\"working\":3,\"blocked\":0,\"done\":2,\"idle\":1,\"unknown\":0}}";
    static const char partial[] =
        "{\"type\":\"state\",\"v\":1,\"seq\":7,\"state\":\"working\"}";
    static const char wide[] =
        "{\"type\":\"state\",\"v\":1,\"seq\":8,\"state\":\"done\",\"textGap\":16,"
        "\"label\":\"Ready\",\"name\":\"All agents\",\"counts\":{"
        "\"working\":0,\"blocked\":0,\"done\":2,\"idle\":1,\"unknown\":0}}";
    static const char *bad_gaps[] = {"12", "0", "8.5", "-8", "\"8\"", "true", "null"};
    static EXT_RAM_BSS_ATTR status_snapshot_t parsed;
    assert(parse_state_frame(valid, sizeof(valid) - 1, &parsed));
    assert(parsed.seq == 7 && parsed.state == FACE_WORKING && parsed.counts[2] == 2);
    cJSON *attention_test = cJSON_Parse("{\"attention\":{\"id\":\"12345678-abcd-1234-abcd-123456789012\",\"revision\":1,\"detail\":true,\"body\":\"Review this change\",\"actions\":[{\"id\":\"approve\",\"label\":\"Approve\"},{\"id\":\"cancel\",\"label\":\"Cancel\"}]}}");
    assert(attention_test && attention_parse(attention_test, &parsed.attention));
    assert(parsed.attention.active && parsed.attention.detail && parsed.attention.count == 2);
    cJSON *attention_object = cJSON_GetObjectItemCaseSensitive(attention_test, "attention");
    cJSON_ReplaceItemInObject(attention_object, "revision", cJSON_CreateNumber(-1));
    assert(!attention_parse(attention_test, &parsed.attention));
    cJSON_ReplaceItemInObject(attention_object, "revision", cJSON_CreateNumber(2));
    cJSON *first_action = cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(attention_object, "actions"), 0);
    cJSON_ReplaceItemInObject(first_action, "id", cJSON_CreateString("open"));
    assert(!attention_parse(attention_test, &parsed.attention));
    cJSON_Delete(attention_test);
    assert(!parsed.name_shimmer); // missing flag keeps existing static subtitles
    assert(parsed.text_gap == TEXT_GAP_DEFAULT); // omitted textGap uses the balanced default
    assert(!parse_state_frame(partial, sizeof(partial) - 1, &parsed));
    assert(parse_state_frame(wide, sizeof(wide) - 1, &parsed) && parsed.text_gap == 16);
    assert(status_top_for_gap(4) == 364 && status_top_for_gap(8) == 360 && status_top_for_gap(16) == 352);
    char mapped[768];
    int mapped_length = snprintf(mapped, sizeof(mapped),
        "{\"type\":\"state\",\"v\":1,\"seq\":9,\"state\":\"working\","
        "\"expression\":\"sleep\",\"module\":\"face\",\"moduleIndex\":0,\"moduleCount\":3,"
        "\"label\":\"Working\",\"name\":\"Agent\",\"counts\":{"
        "\"working\":1,\"blocked\":0,\"done\":0,\"idle\":0,\"unknown\":0}}");
    assert(mapped_length > 0 && (size_t)mapped_length < sizeof(mapped));
    assert(parse_state_frame(mapped, (size_t)mapped_length, &parsed));
    assert(parsed.state == FACE_WORKING && !parsed.preview);
    assert(parsed.has_expression && parsed.expression == FACE_SLEEP && parsed.module.count == 3);
    static const char *flags[] = {"true", "false", "null", "1", "\"true\"", "[]", "{}"};
    for (size_t i = 0; i < sizeof(flags) / sizeof(flags[0]); ++i) {
        int length = snprintf(mapped, sizeof(mapped),
            "{\"type\":\"state\",\"v\":1,\"seq\":10,\"state\":\"blocked\",\"nameShimmer\":%s,"
            "\"label\":\"Needs input\",\"name\":\"Working session\",\"counts\":{"
            "\"working\":1,\"blocked\":1,\"done\":0,\"idle\":0,\"unknown\":0}}", flags[i]);
        assert(length > 0 && (size_t)length < sizeof(mapped));
        assert(parse_state_frame(mapped, (size_t)length, &parsed) == (i < 2));
        if (i < 2) assert(parsed.name_shimmer == (i == 0));
    }
    parsed = (status_snapshot_t){.state = FACE_BLOCKED, .name_shimmer = true,
        .module = {.kind = DISPLAY_FACE}, .name = "Working session"};
    assert(name_shimmer_enabled(&parsed, false)); // blocked with workers
    assert(!name_shimmer_enabled(&parsed, true));
    parsed.preview = true;
    assert(!name_shimmer_enabled(&parsed, false));
    parsed.preview = false;
    parsed.module.kind = DISPLAY_CLOCK;
    assert(!name_shimmer_enabled(&parsed, false));
    parsed.module.kind = DISPLAY_FACE;
    parsed.state = FACE_DISCONNECTED;
    assert(!name_shimmer_enabled(&parsed, false));
    parsed.state = FACE_WORKING;
    parsed.name[0] = '\0';
    assert(!name_shimmer_enabled(&parsed, false));
    for (size_t i = 0; i < sizeof(bad_gaps) / sizeof(bad_gaps[0]); ++i) {
        char frame[sizeof(wide) + 8];
        int length = snprintf(frame, sizeof(frame), "{\"type\":\"state\",\"v\":1,\"seq\":8,\"state\":\"done\",\"textGap\":%s,"
            "\"label\":\"Ready\",\"name\":\"All agents\",\"counts\":{"
            "\"working\":0,\"blocked\":0,\"done\":2,\"idle\":1,\"unknown\":0}}", bad_gaps[i]);
        assert(length > 0 && (size_t)length < sizeof(frame));
        assert(!parse_state_frame(frame, (size_t)length, &parsed));
    }
}

static void serial_write_line(const char *line)
{
    size_t remaining = strlen(line);
    while (remaining > 0) {
        int written = usb_serial_jtag_write_bytes(line, remaining, pdMS_TO_TICKS(100));
        if (written <= 0) {
            return;
        }
        line += written;
        remaining -= (size_t)written;
    }
}

static void accept_state(const status_snapshot_t *parsed)
{
    int64_t now = esp_timer_get_time();
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    bool was_disconnected = !shared_status.ever_received ||
                            now - shared_status.last_valid_us >= DISCONNECT_US;
    bool reset_age = was_disconnected || shared_status.state != parsed->state ||
        shared_status.preview != parsed->preview ||
        shared_status.has_expression != parsed->has_expression || shared_status.expression != parsed->expression ||
        shared_status.module.kind != parsed->module.kind ||
        (parsed->has_epoch && (!shared_status.has_epoch || shared_status.epoch != parsed->epoch));
    if (parsed->has_timing) {
        int64_t host_since = now - (int64_t)parsed->age_ms * 1000;
        // Ignore small delivery jitter while preserving explicit state changes and replays.
        if (reset_age || !shared_status.has_timing || llabs(host_since-shared_status.state_since_us)>100000)
            shared_status.state_since_us = host_since;
    } else if (reset_age) shared_status.state_since_us = now;
    shared_status.has_timing = parsed->has_timing;
    shared_status.has_epoch = parsed->has_epoch;
    shared_status.epoch = parsed->has_epoch ? parsed->epoch : 0;
    if (was_disconnected || shared_status.state != parsed->state || shared_status.preview != parsed->preview || shared_status.status_dots != parsed->status_dots || shared_status.name_shimmer != parsed->name_shimmer ||
        shared_status.text_gap != parsed->text_gap || shared_status.rotation != parsed->rotation ||
        memcmp(&shared_status.module, &parsed->module, sizeof(parsed->module)) != 0 ||
        memcmp(&shared_status.attention, &parsed->attention, sizeof(parsed->attention)) != 0 ||
        strcmp(shared_status.label, parsed->label) != 0 || strcmp(shared_status.name, parsed->name) != 0) ++shared_status.revision;
    shared_status.animation_ms = parsed->has_timing ? parsed->animation_ms : now / 1000.0;
    shared_status.state = parsed->state;
    shared_status.preview = parsed->preview;
    shared_status.status_dots = parsed->status_dots;
    shared_status.name_shimmer = parsed->name_shimmer;
    shared_status.text_gap = parsed->text_gap; // layout only: never resets the animation age
    shared_status.rotation = parsed->rotation;
    shared_status.expression = parsed->expression;
    shared_status.has_expression = parsed->has_expression;
    shared_status.module = parsed->module;
    shared_status.attention = parsed->attention;
    shared_status.has_look = parsed->has_look;
    shared_status.look_x = parsed->look_x;
    shared_status.look_y = parsed->look_y;
    shared_status.seq = parsed->seq;
    memcpy(shared_status.counts, parsed->counts, sizeof(shared_status.counts));
    memcpy(shared_status.label, parsed->label, sizeof(shared_status.label));
    memcpy(shared_status.name, parsed->name, sizeof(shared_status.name));
    shared_status.last_valid_us = now;
    shared_status.ever_received = true;
    uint32_t drawn_seq = rendered_seq, duration = render_us;
    int shimmer_pixels = rendered_shimmer_pixels;
    int name_shimmer_pixels = rendered_name_shimmer_pixels;
    int text_gap = rendered_text_gap, status_top = rendered_status_top;
    display_module_t drawn_module = rendered_module;
    uint16_t page_index = rendered_page_index, page_count = rendered_page_count;
    bool refreshing = rendered_refreshing;
    bool font_error = rendered_font_error;
    bool light_theme = rendered_light_theme;
    unsigned rotation = rendered_rotation;
    face_eye_t drawn[2];
    memcpy(drawn, rendered_eyes, sizeof(drawn));
    xSemaphoreGive(state_mutex);

    char ack[1024];
    snprintf(ack, sizeof(ack), "{\"type\":\"ack\",\"v\":1,\"seq\":%" PRIu32
        ",\"rendered_seq\":%" PRIu32 ",\"render_us\":%" PRIu32 ",\"eyes\":[[%.3f,%.3f],[%.3f,%.3f]],\"shimmer_pixels\":%d,\"name_shimmer_pixels\":%d,\"text_gap\":%d,\"status_top\":%d,\"module\":\"%s\",\"page_index\":%u,\"page_count\":%u,\"refreshing\":%s,\"font_error\":%s,\"rotation\":%u,\"panel_transfers\":%u,\"panel_error\":%u,\"panel_rotation\":%u,\"rotation_us\":%u,\"rotation_pixels\":%u,\"theme\":\"%s\",\"dma_largest\":%u,\"internal_free\":%u,\"touch_reads\":%u,\"touch_errors\":%u,\"touch_revision\":%u}\n",
        parsed->seq, drawn_seq, duration, drawn[0].w, drawn[0].h, drawn[1].w, drawn[1].h, shimmer_pixels, name_shimmer_pixels, text_gap, status_top, display_module_name(drawn_module), page_index, page_count, refreshing ? "true" : "false", font_error ? "true" : "false", rotation, screen_rotation_transfers(), screen_rotation_transfer_error(), screen_rotation_submitted_angle(), screen_rotation_render_us(), screen_rotation_render_pixels(), light_theme ? "light" : "dark", (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL), (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL), (unsigned)companion_board_touch_reads(), (unsigned)companion_board_touch_errors(), (unsigned)companion_board_touch_revision());
    serial_write_line(ack);
}

static void handle_line(char *line, size_t length)
{
    status_snapshot_t parsed = {0};
    if (parse_state_frame(line, length, &parsed)) {
        accept_state(&parsed);
    } else if (length && length <= FRAME_MAX && memchr(line, '\0', length) == NULL) {
        const char *end = NULL;
        cJSON *root = cJSON_ParseWithLengthOpts(line, length + 1, &end, true);
        if (root) {
            roon_art_ack_t result;
            xSemaphoreTake(state_mutex, portMAX_DELAY);
            bool handled = roon_artwork_handle(&roon_artwork, root, &result);
            xSemaphoreGive(state_mutex);
            if (handled) {
                char ack[160];
                snprintf(ack, sizeof(ack), "{\"type\":\"artAck\",\"v\":1,\"transfer\":%" PRIu32
                    ",\"op\":\"%s\",\"ok\":%s,\"offset\":%" PRIu32 "}\n",
                    result.transfer, result.op, result.ok ? "true" : "false", result.offset);
                serial_write_line(ack);
            }
            cJSON_Delete(root);
        }
    }
}

static bool host_timed_out(int64_t now)
{
    bool timed_out;
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    timed_out = !shared_status.ever_received ||
                now - shared_status.last_valid_us >= DISCONNECT_US;
    xSemaphoreGive(state_mutex);
    return timed_out;
}

static void serial_task(void *argument)
{
    (void)argument;
    static char line[FRAME_MAX + 1];
    uint8_t input[128];
    size_t line_length = 0;
    bool discarding = false;
    int64_t next_ready_us = 0;

    while (true) {
        int64_t now = esp_timer_get_time();
        if (now >= next_ready_us && host_timed_out(now)) {
            serial_write_line(companion_board_ready_json());
            next_ready_us = now + READY_PERIOD_US;
        }

        touch_message_t message;
        while (xQueueReceive(cycle_queue, &message, 0) == pdTRUE) {
            int8_t event = message.action;
            if (event == 0) serial_write_line(CYCLE_JSON);
            else if (event == 10) {
                char line[192];
                snprintf(line, sizeof(line), "{\"type\":\"attention\",\"v\":1,\"id\":\"%s\",\"revision\":%" PRIu32 ",\"action\":\"%s\"}\n",
                    message.attention_id, message.attention_revision, message.attention_action);
                serial_write_line(line);
            }
            else if (event == 9) {
                char line[144];
                snprintf(line, sizeof(line), "{\"type\":\"open-card\",\"v\":1,\"module\":\"%s\",\"index\":%u,\"token\":\"%s\"}\n",
                    display_module_name(message.card.module), message.card.index, message.card.token);
                serial_write_line(line);
            }
            else if ((event >= 4 && event <= 6) || event == 11 || event == 20) {
                const char *action = event == 4 ? "previous" : event == 5 ? "playpause" : event == 6 ? "next" : event == 20 ? "open" : "like";
                const char *player = message.player == MUSIC_SPOTIFY ? "spotify" : message.player == MUSIC_SYSTEM ? "system" : message.player == MUSIC_APPLE_MUSIC ? "appleMusic" : "roon";
                char line[96];
                snprintf(line, sizeof(line), "{\"type\":\"roon-control\",\"v\":1,\"action\":\"%s\",\"player\":\"%s\"}\n", action, player);
                serial_write_line(line);
            }
            else if (event == 7 || event == 8) serial_write_line(event == 7 ?
                "{\"type\":\"roon-view\",\"v\":1,\"expanded\":true}\n" : "{\"type\":\"roon-view\",\"v\":1,\"expanded\":false}\n");
            else if (event == 18) {
                char line[160];
                snprintf(line, sizeof(line), "{\"type\":\"speed-dial-run\",\"v\":1,\"id\":\"%s\",\"token\":\"%s\"}\n",
                    message.speed_dial_id, message.speed_dial_token);
                serial_write_line(line);
            }
            else if (event == 19 || event == -19) serial_write_line(event > 0 ?
                "{\"type\":\"speed-dial-page\",\"v\":1,\"direction\":1}\n" :
                "{\"type\":\"speed-dial-page\",\"v\":1,\"direction\":-1}\n");
            else if (event == 17) {
                char line[128];
                snprintf(line, sizeof(line), "{\"type\":\"audio-view\",\"v\":1,\"open\":true,\"scope\":\"%s\",\"deviceId\":%" PRIu32 "}\n",
                    message.audio_input ? "input" : "output", message.audio_device_id);
                serial_write_line(line);
            }
            else if (event == 14 || event == 15 || event == 16) {
                char line[160], value[24];
                if (event == 16) snprintf(value, sizeof(value), "%" PRIu32, message.audio_target_device_id);
                else if (event == 15) snprintf(value, sizeof(value), "%s", message.audio_muted ? "true" : "false");
                else snprintf(value, sizeof(value), "%.2f", (double)message.audio_volume);
                snprintf(line, sizeof(line), "{\"type\":\"audio-control\",\"v\":1,\"scope\":\"%s\",\"deviceId\":%" PRIu32 ",\"action\":\"%s\",\"value\":%s}\n",
                    message.audio_input ? "input" : "output", message.audio_device_id, event == 16 ? "device" : event == 15 ? "mute" : "volume", value);
                serial_write_line(line);
            }
            else if (event == 13 || event == -13) serial_write_line(event > 0 ?
                "{\"type\":\"audio-page\",\"v\":1,\"direction\":1}\n" : "{\"type\":\"audio-page\",\"v\":1,\"direction\":-1}\n");
            else if (event == 12 || event == -12) serial_write_line(event > 0 ?
                "{\"type\":\"roon-player\",\"v\":1,\"direction\":1}\n" :
                "{\"type\":\"roon-player\",\"v\":1,\"direction\":-1}\n");
            else if (event == 2 || event == -2) serial_write_line(event > 0 ? "{\"type\":\"usage-page\",\"v\":1,\"direction\":1}\n" :
                "{\"type\":\"usage-page\",\"v\":1,\"direction\":-1}\n");
            else if (event == 3 || event == -3) serial_write_line(event > 0 ? "{\"type\":\"hey-page\",\"v\":1,\"direction\":1}\n" :
                "{\"type\":\"hey-page\",\"v\":1,\"direction\":-1}\n");
            else serial_write_line(event > 0 ? "{\"type\":\"module\",\"v\":1,\"direction\":1}\n" :
                "{\"type\":\"module\",\"v\":1,\"direction\":-1}\n");
        }

        int received = usb_serial_jtag_read_bytes(input, sizeof(input), pdMS_TO_TICKS(20));
        for (int i = 0; i < received; ++i) {
            uint8_t byte = input[i];
            if (byte == '\n') {
                if (!discarding && line_length > 0) {
                    line[line_length] = '\0';
                    handle_line(line, line_length);
                }
                line_length = 0;
                discarding = false;
            } else if (byte != '\r' && !discarding) {
                if (line_length < FRAME_MAX) {
                    line[line_length++] = (char)byte;
                } else {
                    line_length = 0;
                    discarding = true;
                }
            }
        }
    }
}

static void status_copy(status_snapshot_t *copy)
{
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    *copy = shared_status;
    xSemaphoreGive(state_mutex);
}

// Rasterize the status text into the offscreen mask synchronously (finish_layer waits for the draw units).
static void render_text_mask(lv_obj_t *canvas, uint16_t *mask, int buffer_width, int height,
                             int text_width, const lv_font_t *font, int letter_space, const char *text)
{
    memset(mask, 0, buffer_width * height * sizeof(uint16_t));
    lv_layer_t layer;
    lv_canvas_init_layer(canvas, &layer);
    lv_draw_label_dsc_t dsc;
    lv_draw_label_dsc_init(&dsc);
    dsc.text = text;
    dsc.font = font;
    dsc.color = lv_color_white();
    dsc.letter_space = letter_space;
    dsc.align = LV_TEXT_ALIGN_CENTER;
    dsc.flag = LV_TEXT_FLAG_EXPAND; // Reuse the visible label's ellipsis, without wrapping it again.
    lv_area_t coords = {0, 0, text_width - 1, height - 1};
    lv_draw_label(&layer, &dsc, &coords);
    lv_canvas_finish_layer(canvas, &layer);
}

static void queue_attention(const attention_snapshot_t *attention, const char *action)
{
    touch_message_t queued = { .action = 10, .attention_revision = attention->revision };
    snprintf(queued.attention_id, sizeof(queued.attention_id), "%s", attention->id);
    snprintf(queued.attention_action, sizeof(queued.attention_action), "%s", action);
    xQueueSend(cycle_queue, &queued, 0);
}

static void refresh_face(lv_timer_t *timer)
{
    (void)timer;
    int64_t now = esp_timer_get_time();
    static EXT_RAM_BSS_ATTR status_snapshot_t status;
    status_copy(&status);
    if (screen_rotation_apply(status.rotation)) {
        ++display_rotation_revision;
        companion_board_touch_cancel();
        lv_indev_t *input = companion_board_input();
        if (input) { lv_indev_reset(input, NULL); lv_indev_wait_release(input); }
        shown_revision = UINT32_MAX;
        lv_obj_invalidate(lv_screen_active());
    }
    bool artwork_changed = false;
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    if (shown_art_revision != roon_artwork.revision) {
        shown_art_revision = roon_artwork.revision;
        module_view_set_artwork(roon_artwork.id, roon_artwork.pixels);
        artwork_changed = true;
    }
    xSemaphoreGive(state_mutex);
    bool disconnected = !status.ever_received || now - status.last_valid_us >= DISCONNECT_US;
    const attention_snapshot_t *shown_attention = attention_view_snapshot();
    if (disconnected || !status.attention.active || strcmp(shown_attention->id, status.attention.id) ||
        shown_attention->revision != status.attention.revision || shown_attention->detail != status.attention.detail)
        attention_gesture_cancel(&attention_gesture);
    if (attention_touch_revision != companion_board_touch_revision()) attention_gesture_cancel(&attention_gesture);
    const char *attention_action = attention_gesture_poll(&attention_gesture, &status.attention, display_rotation_revision, now);
    if (attention_action) queue_attention(&status.attention, attention_action);

    face_state_t state = disconnected ? FACE_DISCONNECTED : status.state;
    int64_t state_elapsed = disconnected ? 0 : now - status.state_since_us;
    face_state_t pose = disconnected ? FACE_DISCONNECTED : status.has_expression ? status.expression : state;
    bool asleep = pose == FACE_SLEEP || (pose == FACE_IDLE && !status.has_expression && !status.preview && state_elapsed >= IDLE_SLEEP_US);
    // Working uses the same status shimmer in live view and the playground.
    // The legacy status_dots field is parsed only for wire compatibility.
    bool face_visible = status.module.kind == DISPLAY_FACE;
    bool shimmer_active = face_visible && state == FACE_WORKING;
    bool name_shimmer_active = name_shimmer_enabled(&status, disconnected);
    module_design_t design;
    if (face_visible) display_module_design(&status.module, &design);
    else module_design_default(DISPLAY_FACE, &design);
    const face_design_t *layout = &design.face;
    const lv_font_t *title_font = design_font(DESIGN_FONT_FACE_TITLE, layout->titleSize);
    const lv_font_t *name_font = design_font(DESIGN_FONT_FACE_NAME, layout->nameSize);
    // The last accepted gap is kept through a host timeout; before any frame it is the default.
    int status_top = status_top_for_gap(status.text_gap) + layout->titleOffset;
    double animation_time = status.animation_ms / 1000.0 + (now - status.last_valid_us) / 1000000.0;
    if (!status.ever_received) animation_time = now / 1000000.0;

    if (shown_revision != status.revision || shown_state != state || artwork_changed) {
        shown_revision = status.revision;
        shown_state = state;
        lv_obj_set_style_bg_color(lv_screen_active(), lv_color_hex(status.module.palette.background), 0);
        module_view_update(&status.module, disconnected);
        if (disconnected) status.attention.active = false;
        attention_view_update(&status.attention, status.label, &status.module.palette);
        if (face_visible) {
            lv_obj_remove_flag(face_canvas, LV_OBJ_FLAG_HIDDEN);
            lv_obj_remove_flag(status_label, LV_OBJ_FLAG_HIDDEN);
            lv_obj_remove_flag(name_label, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(face_canvas, LV_OBJ_FLAG_HIDDEN);
            lv_obj_add_flag(status_label, LV_OBJ_FLAG_HIDDEN);
            lv_obj_add_flag(name_label, LV_OBJ_FLAG_HIDDEN);
        }
        lv_obj_set_size(status_label, layout->titleWidth, title_font->line_height);
        lv_obj_set_style_text_font(status_label, title_font, 0);
        lv_obj_align(status_label, LV_ALIGN_TOP_MID, 0, status_top);
        lv_obj_set_size(name_label, layout->nameWidth, name_font->line_height);
        lv_obj_set_style_text_font(name_label, name_font, 0);
        lv_obj_set_style_text_color(name_label, lv_color_hex(layout->mutedColor), 0);
        lv_obj_align(name_label, LV_ALIGN_TOP_MID, 0, layout->nameY);
        if (disconnected) {
            lv_label_set_text(status_label, "Disconnected");
            lv_label_set_text(name_label, "Waiting for host");
            lv_obj_set_style_text_color(status_label, lv_color_hex(layout->textColor == 0xf2edfa ? 0xb6aec5 : layout->textColor), 0);
        } else {
            lv_label_set_text(status_label, status.label);
            lv_label_set_text(name_label, status.name);
            lv_obj_set_style_text_color(status_label, lv_color_hex(layout->textColor), 0);
        }
        if (shimmer_active) {
            lv_obj_update_layout(status_label);
            render_text_mask(shimmer_canvas, shimmer_mask, SHIMMER_MASK_W, SHIMMER_MASK_H,
                layout->titleWidth, title_font, 1, lv_label_get_text(status_label));
            lv_label_set_text(status_label, "");
        }
        if (name_shimmer_active) {
            // Reuse the label's exact single-line truncation before hiding its static copy.
            lv_obj_update_layout(name_label);
            render_text_mask(name_shimmer_canvas, name_shimmer_mask, NAME_MASK_W, NAME_MASK_H,
                             layout->nameWidth, name_font, 0, lv_label_get_text(name_label));
            lv_label_set_text(name_label, "");
        }
    }
    module_view_tick(animation_time);

    if (!face_visible) {
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        memset(rendered_eyes, 0, sizeof(rendered_eyes));
        rendered_seq = status.seq;
        rendered_shimmer_pixels = rendered_name_shimmer_pixels = 0;
        rendered_text_gap = status.text_gap;
        rendered_status_top = status_top;
        rendered_module = status.module.kind;
        rendered_page_index = status.module.page_index;
        rendered_page_count = status.module.page_count;
        rendered_refreshing = status.module.kind != DISPLAY_CLOCK && status.module.refreshing && status.module.status == MODULE_READY && !disconnected;
        rendered_font_error = design_fonts_have_error();
        rendered_rotation = screen_rotation_current();
        rendered_light_theme = status.module.light_theme;
        render_us = (uint32_t)(esp_timer_get_time() - now);
        xSemaphoreGive(state_mutex);
        return;
    }

    if (animation_time < last_animation_time - .1) face_motion_init(&motion, asleep ? FACE_SLEEP : pose, animation_time);
    last_animation_time = animation_time;
    face_motion_state(&motion, asleep ? FACE_SLEEP : pose, animation_time);
    face_motion_look(&motion, !disconnected && status.has_look, status.look_x, status.look_y, animation_time);
    face_eye_t frame[2];
    int64_t start = esp_timer_get_time();
    face_motion_sample(&motion, animation_time, frame);
    uint32_t eye_color = face_motion_color(&motion);
    if (pose == FACE_IDLE || pose == FACE_SLEEP || pose == FACE_UNKNOWN) eye_color = status.module.palette.foreground;
    else if (pose == FACE_DISCONNECTED) eye_color = status.module.palette.muted;
    else if (pose == FACE_WORKING && status.module.palette.accent != 0x65c18c) eye_color = status.module.palette.accent;
    else if (pose == FACE_DONE && status.module.palette.success != 0x65c18c) eye_color = status.module.palette.success;
    else if (pose == FACE_BLOCKED && status.module.palette.warning != 0xd9be81) eye_color = status.module.palette.warning;
    face_rasterize_themed(face_pixels, COMPANION_DISPLAY_WIDTH, COMPANION_DISPLAY_HEIGHT, frame, eye_color, layout->scale, status.module.palette.background);
    int shimmer_pixels = 0;
    if (shimmer_active) {
        uint32_t base = status.module.palette.muted;
        uint32_t peak = layout->textColor;
        shimmer_pixels = face_shimmer_blit_palette(shimmer_mask, SHIMMER_MASK_W, SHIMMER_MASK_H, face_pixels, COMPANION_DISPLAY_WIDTH, COMPANION_DISPLAY_HEIGHT,
            (COMPANION_DISPLAY_WIDTH - layout->titleWidth) / 2, status_top, animation_time, false, base, peak);
    }
    int name_shimmer_pixels = 0;
    if (name_shimmer_active) {
        uint32_t base = layout->mutedColor;
        uint32_t peak = status.module.palette.foreground;
        name_shimmer_pixels = face_shimmer_blit_palette(name_shimmer_mask, NAME_MASK_W, NAME_MASK_H,
            face_pixels, COMPANION_DISPLAY_WIDTH, COMPANION_DISPLAY_HEIGHT, (COMPANION_DISPLAY_WIDTH - layout->nameWidth) / 2, layout->nameY, animation_time, false, base, peak);
    }
    lv_obj_invalidate(face_canvas);
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    memcpy(rendered_eyes, frame, sizeof(frame));
    rendered_seq = status.seq;
    rendered_module = DISPLAY_FACE;
    rendered_page_index = 0;
    rendered_page_count = 1;
    rendered_refreshing = false;
    rendered_font_error = design_fonts_have_error();
    rendered_rotation = screen_rotation_current();
        rendered_light_theme = status.module.light_theme;
    rendered_shimmer_pixels = shimmer_pixels;
    rendered_name_shimmer_pixels = name_shimmer_pixels;
    rendered_text_gap = status.text_gap;
    rendered_status_top = status_top;
    render_us = (uint32_t)(esp_timer_get_time() - start);
    xSemaphoreGive(state_mutex);
}

// Track one physical contact on the screen. Release emits one action, never a click after a swipe.
static void touch_event(lv_event_t *event)
{
    static module_touch_t touch;
    static module_card_target_t pressed_card;
    static speed_dial_target_t pressed_speed_dial;
    static uint32_t pressed_rotation_revision, pressed_touch_revision;
    static EXT_RAM_BSS_ATTR attention_snapshot_t pressed_attention;
    static int pressed_x, pressed_y;
    static display_module_t pressed_module;
    static music_player_t pressed_player;
    static bool pressed_player_badge;
    static bool pressed_audio_input, pressed_audio_picker;
    static uint16_t pressed_audio_page;
    static uint32_t pressed_audio_target;
    static uint32_t pressed_audio_device;
    static EXT_RAM_BSS_ATTR status_snapshot_t status;
    lv_indev_t *input = lv_indev_active();
    if (input == NULL) return;
    lv_point_t point;
    lv_indev_get_point(input, &point);
    int logical_x, logical_y;
    screen_unrotate_point(screen_rotation_current(), point.x, point.y, &logical_x, &logical_y);
    point.x = logical_x; point.y = logical_y;
    lv_event_code_t code = lv_event_get_code(event);
    int64_t sample_time = companion_board_touch_sample_time_us();
    uint32_t touch_revision = companion_board_touch_revision();
    if (!companion_board_touch_sample_valid()) {
        module_view_speed_dial_cancel();
        touch.active = false;
        attention_gesture_cancel(&attention_gesture);
        return;
    }
    if (code == LV_EVENT_PRESSED) {
        module_touch_begin(&touch, point.x, point.y, sample_time);
        pressed_touch_revision = touch_revision;
        pressed_rotation_revision = display_rotation_revision;
        pressed_attention = *attention_view_snapshot();
        attention_gesture_press(&attention_gesture, sample_time);
        pressed_x = point.x; pressed_y = point.y;
        status_copy(&status);
        pressed_module = status.module.kind; pressed_player = status.module.player;
        pressed_player_badge = module_view_roon_badge_hit(point.x, point.y, pressed_player);
        pressed_audio_input = status.module.audio_input; pressed_audio_device = status.module.audio_device_id;
        pressed_audio_picker = status.module.audio_picker_open; pressed_audio_page = status.module.page_index;
        int audio_row = module_touch_audio_row(point.x, point.y, status.module.audio_row_count);
        pressed_audio_target = audio_row >= 0 ? status.module.audio_devices[audio_row].id : 0;
        pressed_card = (module_card_target_t){0};
        module_view_card_at(point.x, point.y, &pressed_card);
        pressed_speed_dial = (speed_dial_target_t){0};
        if (!pressed_attention.active && status.ever_received && esp_timer_get_time() - status.last_valid_us < DISCONNECT_US)
            module_view_speed_dial_press(point.x, point.y, &pressed_speed_dial);
    }
    else if (code == LV_EVENT_PRESSING) {
        module_touch_move(&touch, point.x, point.y);
        if (touch.max_x > 16 || touch.max_y > 16) module_view_speed_dial_cancel();
    }
    else if (code == LV_EVENT_PRESS_LOST) { module_view_speed_dial_cancel(); touch.active = false; attention_gesture_cancel(&attention_gesture); }
    else if (code == LV_EVENT_RELEASED) {
        bool dial_press_valid = module_view_speed_dial_press_valid(point.x, point.y, &pressed_speed_dial);
        module_view_speed_dial_cancel();
        if (pressed_rotation_revision != display_rotation_revision || pressed_touch_revision != touch_revision) { touch.active = false; attention_gesture_cancel(&attention_gesture); return; }
        module_touch_action_t action = module_touch_end(&touch, point.x, point.y, sample_time);
        status_copy(&status);
        if (pressed_module != status.module.kind) return;
        int8_t message;
        if (pressed_attention.active || status.attention.active) {
            if (!status.attention.active || !status.ever_received || esp_timer_get_time() - status.last_valid_us >= DISCONNECT_US ||
                strcmp(pressed_attention.id, status.attention.id) || pressed_attention.revision != status.attention.revision ||
                pressed_attention.detail != status.attention.detail) { attention_gesture_cancel(&attention_gesture); return; }
            if (status.attention.detail && abs(point.y - pressed_y) > 20 && attention_view_body_hit(pressed_x, pressed_y)) {
                attention_gesture_cancel(&attention_gesture);
                attention_view_scroll(pressed_y - point.y);
                return;
            }
            const attention_snapshot_t *shown_attention = attention_view_snapshot();
            if (strcmp(shown_attention->id, status.attention.id) || shown_attention->revision != status.attention.revision ||
                shown_attention->detail != status.attention.detail) { attention_gesture_cancel(&attention_gesture); return; }
            if (action != MODULE_TOUCH_TAP) { attention_gesture_cancel(&attention_gesture); return; }
            const char *hit = attention_view_action(point.x, point.y);
            const char *start = attention_view_action(pressed_x, pressed_y);
            if (!hit || !start || strcmp(hit, start)) hit = NULL;
            attention_touch_revision = touch_revision;
            if (attention_gesture_tap(&attention_gesture, shown_attention, display_rotation_revision,
                point.x, point.y, sample_time, hit)) queue_attention(shown_attention, "__dismiss");
            return;
        }
        if (action == MODULE_TOUCH_TAP && pressed_speed_dial.token[0]) {
            if (!dial_press_valid || !status.ever_received || esp_timer_get_time() - status.last_valid_us >= DISCONNECT_US ||
                !speed_dial_target_valid(&status.module, point.x, point.y, &pressed_speed_dial)) return;
            touch_message_t run = {.action = 18};
            memcpy(run.speed_dial_id, pressed_speed_dial.id, sizeof(run.speed_dial_id));
            memcpy(run.speed_dial_token, pressed_speed_dial.token, sizeof(run.speed_dial_token));
            xQueueSend(cycle_queue, &run, 0);
            return;
        }
        if (action == MODULE_TOUCH_TAP && pressed_card.token[0]) {
            module_card_target_t released;
            if (!status.ever_received || esp_timer_get_time() - status.last_valid_us >= DISCONNECT_US ||
                status.module.status != MODULE_READY || status.module.kind != pressed_card.module ||
                strcmp(status.module.open_token, pressed_card.token) ||
                !module_view_card_at(point.x, point.y, &released) || released.module != pressed_card.module ||
                released.index != pressed_card.index || strcmp(released.token, pressed_card.token)) return;
            const touch_message_t open = { .action = 9, .card = released };
            xQueueSend(cycle_queue, &open, 0);
            return;
        }
        else if (action == MODULE_TOUCH_TAP && status.module.kind == DISPLAY_FACE) message = 0;
        else if (action == MODULE_TOUCH_TAP && status.module.kind == DISPLAY_ROON && status.module.status == MODULE_READY &&
                 status.ever_received && esp_timer_get_time() - status.last_valid_us < DISCONNECT_US) {
            if (pressed_module != DISPLAY_ROON || pressed_player != status.module.player) return;
            module_design_t design;
            display_module_design(&status.module, &design);
            bool badge_hit = module_view_roon_badge_hit(point.x, point.y, pressed_player);
            if (pressed_player_badge || badge_hit) {
                if (!pressed_player_badge || !badge_hit) return;
                message = 20;
            }
            else if (status.module.can_like && module_view_roon_like_hit(point.x, point.y) &&
                module_view_roon_like_hit(pressed_x, pressed_y)) message = 11;
            else if ((status.module.expanded || status.module.art_id[0]) && module_view_roon_art_hit(point.x, point.y)) {
                message = status.module.expanded ? 8 : 7;
            } else {
                if (status.module.expanded || !module_view_roon_controls_ready()) return;
                int button = module_touch_roon(point.x, point.y, design.roon.controlsY, design.roon.controlSize, design.roon.gap,
                    status.module.can_previous, status.module.can_next);
                if (!button) return;
                message = button + 3;
            }
        }
        else if (action == MODULE_TOUCH_TAP && status.module.kind == DISPLAY_AUDIO && status.module.status == MODULE_READY &&
                 status.ever_received && esp_timer_get_time() - status.last_valid_us < DISCONNECT_US) {
            if (pressed_module != DISPLAY_AUDIO || pressed_audio_input != status.module.audio_input || pressed_audio_device != status.module.audio_device_id || !pressed_audio_device) return;
            module_design_t design; display_module_design(&status.module, &design);
            const audio_design_t *layout = &design.audio;
            if (pressed_audio_picker != status.module.audio_picker_open || pressed_audio_page != status.module.page_index) return;
            if (status.module.audio_picker_open) {
                int row = module_touch_audio_row(point.x, point.y, status.module.audio_row_count);
                int pressed_row = module_touch_audio_row(pressed_x, pressed_y, status.module.audio_row_count);
                if (row < 0 || row != pressed_row || !pressed_audio_target || status.module.audio_devices[row].id != pressed_audio_target) return;
                touch_message_t control = {.action = 16, .audio_input = pressed_audio_input, .audio_device_id = pressed_audio_device, .audio_target_device_id = pressed_audio_target};
                xQueueSend(cycle_queue, &control, 0); return;
            }
            if (module_view_audio_open_hit(point.x, point.y) && module_view_audio_open_hit(pressed_x, pressed_y)) {
                touch_message_t view = {.action = 17, .audio_input = pressed_audio_input, .audio_device_id = pressed_audio_device};
                xQueueSend(cycle_queue, &view, 0); return;
            }
            int button = module_touch_roon(point.x, point.y, layout->controlsY, layout->controlSize, layout->gap, status.module.audio_can_volume && status.module.audio_volume > 0, status.module.audio_can_volume && status.module.audio_volume < 100);
            int pressed_button = module_touch_roon(pressed_x, pressed_y, layout->controlsY, layout->controlSize, layout->gap, true, true);
            if (!button || button != pressed_button || (button == 2 && !status.module.audio_can_mute)) return;
            touch_message_t control = {.action = button == 2 ? 15 : 14, .audio_input = pressed_audio_input, .audio_device_id = pressed_audio_device,
                .audio_volume = fminf(100, fmaxf(0, status.module.audio_volume + (button == 1 ? -5 : 5))), .audio_muted = !status.module.audio_muted};
            xQueueSend(cycle_queue, &control, 0); return;
        }
        else if (action == MODULE_TOUCH_PAGE_NEXT && status.module.kind == DISPLAY_SPEED_DIAL && status.module.page_count > 1) message = 19;
        else if (action == MODULE_TOUCH_PAGE_PREVIOUS && status.module.kind == DISPLAY_SPEED_DIAL && status.module.page_count > 1) message = -19;
        else if (action == MODULE_TOUCH_PAGE_NEXT && status.module.kind == DISPLAY_AUDIO && status.module.page_count > 1) message = 13;
        else if (action == MODULE_TOUCH_PAGE_PREVIOUS && status.module.kind == DISPLAY_AUDIO && status.module.page_count > 1) message = -13;
        else if (action == MODULE_TOUCH_NEXT && status.module.count > 1) message = 1;
        else if (action == MODULE_TOUCH_PREVIOUS && status.module.count > 1) message = -1;
        else if (action == MODULE_TOUCH_PAGE_NEXT && status.module.kind == DISPLAY_ROON && status.module.page_count > 1) message = 12;
        else if (action == MODULE_TOUCH_PAGE_PREVIOUS && status.module.kind == DISPLAY_ROON && status.module.page_count > 1) message = -12;
        else if (action == MODULE_TOUCH_PAGE_NEXT && status.module.kind == DISPLAY_USAGE && status.module.page_count > 1) message = 2;
        else if (action == MODULE_TOUCH_PAGE_PREVIOUS && status.module.kind == DISPLAY_USAGE && status.module.page_count > 1) message = -2;
        else if (action == MODULE_TOUCH_PAGE_NEXT && status.module.kind == DISPLAY_HEY && status.module.status == MODULE_READY && status.module.page_count > 1) message = 3;
        else if (action == MODULE_TOUCH_PAGE_PREVIOUS && status.module.kind == DISPLAY_HEY && status.module.status == MODULE_READY && status.module.page_count > 1) message = -3;
        else return;
        const touch_message_t queued = { .action = message, .player = pressed_player };
        xQueueSend(cycle_queue, &queued, 0);
    }
}

static void make_ui(void)
{
    lv_obj_t *screen = lv_screen_active();
    lv_obj_remove_style_all(screen);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(screen, LV_OPA_COVER, 0);
    lv_obj_add_flag(screen, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(screen, touch_event, LV_EVENT_ALL, NULL);

    face_pixels = heap_caps_malloc(COMPANION_DISPLAY_WIDTH * COMPANION_DISPLAY_HEIGHT * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    assert(face_pixels != NULL);
    memset(face_pixels, 0, COMPANION_DISPLAY_WIDTH * COMPANION_DISPLAY_HEIGHT * sizeof(uint16_t));
    face_canvas = lv_canvas_create(screen);
    lv_canvas_set_buffer(face_canvas, face_pixels, COMPANION_DISPLAY_WIDTH, COMPANION_DISPLAY_HEIGHT, LV_COLOR_FORMAT_RGB565);
    lv_obj_remove_flag(face_canvas, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    face_motion_init(&motion, FACE_DISCONNECTED, 0);

    // Hidden offscreen canvases keep fixed strides while the text area changes.
    shimmer_mask = heap_caps_malloc(SHIMMER_MASK_W * SHIMMER_MASK_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    assert(shimmer_mask != NULL);
    memset(shimmer_mask, 0, SHIMMER_MASK_W * SHIMMER_MASK_H * sizeof(uint16_t));
    assert(lv_draw_buf_width_to_stride(SHIMMER_MASK_W, LV_COLOR_FORMAT_RGB565) == SHIMMER_MASK_W * sizeof(uint16_t));
    shimmer_canvas = lv_canvas_create(screen);
    lv_canvas_set_buffer(shimmer_canvas, shimmer_mask, SHIMMER_MASK_W, SHIMMER_MASK_H, LV_COLOR_FORMAT_RGB565);
    lv_obj_add_flag(shimmer_canvas, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(shimmer_canvas, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);

    name_shimmer_mask = heap_caps_malloc(NAME_MASK_W * NAME_MASK_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    assert(name_shimmer_mask != NULL && lv_font_geist_16.line_height <= NAME_MASK_H);
    memset(name_shimmer_mask, 0, NAME_MASK_W * NAME_MASK_H * sizeof(uint16_t));
    assert(lv_draw_buf_width_to_stride(NAME_MASK_W, LV_COLOR_FORMAT_RGB565) == NAME_MASK_W * sizeof(uint16_t));
    name_shimmer_canvas = lv_canvas_create(screen);
    lv_canvas_set_buffer(name_shimmer_canvas, name_shimmer_mask, NAME_MASK_W, NAME_MASK_H, LV_COLOR_FORMAT_RGB565);
    lv_obj_add_flag(name_shimmer_canvas, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(name_shimmer_canvas, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);

    module_view_create(screen);
    attention_view_create(screen);

    status_label = lv_label_create(screen);
    lv_obj_set_size(status_label, 340, lv_font_geist_22.line_height);
    lv_label_set_long_mode(status_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_align(status_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_font(status_label, &lv_font_geist_22, 0);
    lv_obj_set_style_text_letter_space(status_label, 1, 0);
    lv_label_set_text(status_label, "Disconnected");
    lv_obj_remove_flag(status_label, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(status_label, LV_ALIGN_TOP_MID, 0, status_top_for_gap(TEXT_GAP_DEFAULT));

    name_label = lv_label_create(screen);
    lv_obj_set_size(name_label, 260, lv_font_geist_16.line_height);
    lv_label_set_long_mode(name_label, LV_LABEL_LONG_DOT);
    lv_obj_set_style_text_align(name_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_font(name_label, &lv_font_geist_16, 0);
    lv_obj_set_style_text_color(name_label, lv_color_hex(0x7e768c), 0);
    lv_label_set_text(name_label, "Waiting for host");
    lv_obj_remove_flag(name_label, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_align(name_label, LV_ALIGN_TOP_MID, 0, NAME_TOP);

    lv_timer_create(refresh_face, 33, NULL);
    refresh_face(NULL);
}

static int boot_log(const char *format, va_list args)
{
    char buffer[384];
    int n = vsnprintf(buffer, sizeof(buffer), format, args);
    if (n > 0) usb_serial_jtag_write_bytes(buffer, n < sizeof(buffer) ? n : sizeof(buffer)-1, pdMS_TO_TICKS(20));
    return n;
}

void app_main(void)
{
    protocol_self_check();
    assert(esp_psram_is_initialized());
    assert(heap_caps_get_total_size(MALLOC_CAP_SPIRAM) >= 7 * 1024 * 1024);

    state_mutex = xSemaphoreCreateMutex();
    cycle_queue = xQueueCreate(8, sizeof(touch_message_t));
    assert(state_mutex != NULL && cycle_queue != NULL);
    uint8_t *staging = heap_caps_malloc(ROON_ART_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    uint8_t *pixels = heap_caps_malloc(ROON_ART_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    roon_artwork_init(&roon_artwork, staging, pixels);

    usb_serial_jtag_driver_config_t usb_config = {
        .tx_buffer_size = 1024,
        .rx_buffer_size = 4096,
    };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb_config));

    esp_log_set_vprintf(boot_log);
    ESP_LOGI("boot", "Starting display");
    lv_display_t *display = companion_board_display_start();
    ESP_LOGI("boot", "Display started");
    assert(display != NULL);
    ESP_ERROR_CHECK(companion_board_display_lock(portMAX_DELAY));
    ESP_ERROR_CHECK(companion_board_brightness(40));
    ESP_ERROR_CHECK(screen_rotation_init(display));
    ESP_LOGI("boot", "Making UI");
    make_ui();
    ESP_LOGI("boot", "UI ready");
    companion_board_display_unlock();

    BaseType_t created = xTaskCreate(serial_task, "usb-json", 16384, NULL, 6, NULL);
    assert(created == pdPASS);
}
