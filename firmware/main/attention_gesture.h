#pragma once
#include "attention_protocol.h"

typedef struct {
    bool pending, pressed, second, detail;
    char id[37], action[33];
    uint32_t revision, rotation;
    int x, y;
    int64_t started;
} attention_gesture_t;
void attention_gesture_cancel(attention_gesture_t *gesture);
void attention_gesture_press(attention_gesture_t *gesture, int64_t now);
bool attention_gesture_tap(attention_gesture_t *gesture, const attention_snapshot_t *shown,
    uint32_t rotation, int x, int y, int64_t now, const char *action);
const char *attention_gesture_poll(attention_gesture_t *gesture, const attention_snapshot_t *shown,
    uint32_t rotation, int64_t now);
