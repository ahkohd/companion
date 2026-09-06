#include "attention_gesture.h"
#include <string.h>
#include <stdlib.h>

#define DOUBLE_TAP_US 300000

void attention_gesture_cancel(attention_gesture_t *g) { memset(g, 0, sizeof(*g)); }
void attention_gesture_press(attention_gesture_t *g, int64_t now)
{
    g->pressed = true;
    g->second = g->pending && now - g->started <= DOUBLE_TAP_US;
}

static bool matches(const attention_gesture_t *g, const attention_snapshot_t *shown, uint32_t rotation)
{
    return shown->active && g->revision == shown->revision && g->detail == shown->detail &&
        g->rotation == rotation && !strcmp(g->id, shown->id);
}

bool attention_gesture_tap(attention_gesture_t *g, const attention_snapshot_t *shown,
    uint32_t rotation, int x, int y, int64_t now, const char *action)
{
    int dx = x - g->x, dy = y - g->y;
    bool dismiss = g->pending && matches(g, shown, rotation) && g->second &&
        dx * dx + dy * dy <= 40 * 40;
    attention_gesture_cancel(g);
    if (dismiss) return true;
    if (!shown->active) return false;
    g->pending = true;
    g->revision = shown->revision;
    g->detail = shown->detail;
    g->rotation = rotation;
    g->x = x; g->y = y; g->started = now;
    memcpy(g->id, shown->id, sizeof(g->id));
    if (action) {
        strncpy(g->action, action, sizeof(g->action) - 1);
        g->action[sizeof(g->action) - 1] = 0;
    }
    return false;
}

const char *attention_gesture_poll(attention_gesture_t *g, const attention_snapshot_t *shown,
    uint32_t rotation, int64_t now)
{
    if (!g->pending) return NULL;
    if (!matches(g, shown, rotation)) { attention_gesture_cancel(g); return NULL; }
    if (g->pressed || now - g->started < DOUBLE_TAP_US) return NULL;
    g->pending = false;
    return g->action[0] ? g->action : NULL;
}
