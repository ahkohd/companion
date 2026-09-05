#ifndef DISPLAY_MODULE_H
#define DISPLAY_MODULE_H

#include <stdbool.h>
#include <stdint.h>
#include "cJSON.h"
#include "module_design.h"

#define MODULE_TITLE_CAPACITY 33
#define MODULE_DETAIL_CAPACITY 49
#define MODULE_METRIC_LABEL_CAPACITY 17
#define MODULE_RESET_CAPACITY 25
#define MODULE_BOX_LIMIT 3
#define MODULE_MESSAGE_LIMIT 3
#define MODULE_SENDER_CAPACITY 33
#define MODULE_SUBJECT_CAPACITY 65
#define MODULE_LIMIT 5
#define MODULE_CLOCK_TIME_CAPACITY 8
#define MODULE_WEEKDAY_CAPACITY 4

typedef enum { DISPLAY_FACE, DISPLAY_USAGE, DISPLAY_HEY, DISPLAY_CLOCK, DISPLAY_ROON } display_module_t;
typedef enum { MODULE_READY, MODULE_LOADING, MODULE_UNAVAILABLE, MODULE_AUTH, MODULE_ERROR } module_status_t;

typedef struct {
    char provider[MODULE_METRIC_LABEL_CAPACITY];
    char label[MODULE_METRIC_LABEL_CAPACITY];
    char reset[MODULE_RESET_CAPACITY];
    bool available;
    bool openable;
    float remaining;
} module_metric_t;

typedef struct {
    char label[MODULE_METRIC_LABEL_CAPACITY];
    bool available;
    uint32_t count;
} module_box_t;

typedef struct {
    char sender[MODULE_SENDER_CAPACITY];
    char subject[MODULE_SUBJECT_CAPACITY];
    bool openable;
} module_message_t;

typedef struct {
    uint32_t background, foreground, muted, surface, track, accent, success, warning, danger;
} device_palette_t;

typedef struct {
    bool light_theme;
    bool has_palette;
    device_palette_t palette;
    display_module_t kind;
    uint8_t index;
    uint8_t count;
    bool show_navigation;
    bool show_card_backgrounds;
    bool refreshing;
    bool has_design;
    module_design_t design;
    uint16_t page_index;
    uint16_t page_count;
    module_status_t status;
    char title[MODULE_TITLE_CAPACITY];
    char detail[MODULE_DETAIL_CAPACITY];
    char open_token[41];
    char time[MODULE_CLOCK_TIME_CAPACITY];
    char weekday[MODULE_WEEKDAY_CAPACITY];
    bool blink_separator;
    char track[65], artist[65], art_id[41];
    bool playing, can_previous, can_next, expanded;
    module_metric_t primary;
    module_metric_t secondary;
    bool has_count;
    bool count_more;
    uint32_t total;
    uint8_t box_count;
    module_box_t boxes[MODULE_BOX_LIMIT];
    uint8_t message_count;
    module_message_t messages[MODULE_MESSAGE_LIMIT];
} module_snapshot_t;

// Missing module fields retain the original face protocol.
bool display_module_parse(const cJSON *root, module_snapshot_t *out);
const char *display_module_name(display_module_t kind);
static inline void display_module_design(const module_snapshot_t *module, module_design_t *out)
{
    if (module->has_design) *out = module->design;
    else {
        module_design_default(module->kind, out);
        if (!module->light_theme && !module->has_palette) return;
        const device_palette_t *p = &module->palette;
        switch (module->kind) {
            case DISPLAY_FACE:
                out->face.textColor=p->foreground; out->face.mutedColor=p->muted; break;
            case DISPLAY_USAGE:
                out->usage.textColor=p->foreground; out->usage.mutedColor=p->muted;
                out->usage.cardColor=p->surface; out->usage.trackColor=p->track;
                out->usage.fillColor=p->accent; out->usage.lowColor=p->danger; out->usage.warnColor=p->warning; break;
            case DISPLAY_HEY:
                out->hey.textColor=p->foreground; out->hey.mutedColor=p->muted; out->hey.cardColor=p->surface; break;
            case DISPLAY_CLOCK:
                out->clock.textColor=p->foreground; out->clock.mutedColor=p->muted; break;
            case DISPLAY_ROON:
                out->roon.textColor=p->foreground; out->roon.mutedColor=p->muted; out->roon.accentColor=p->accent; break;
        }
    }
}

#endif
