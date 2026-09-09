#pragma once
#include <stdbool.h>
#include <stdint.h>

#define TOUCH_SAMPLE_CAPACITY 128
#define TOUCH_SAMPLE_MAX_GAP_US 32000

typedef struct {
    int x, y;
    int64_t time_us;
    bool pressed, valid;
} touch_sample_t;

typedef struct {
    touch_sample_t samples[TOUCH_SAMPLE_CAPACITY];
    unsigned head, count;
    uint32_t revision;
    bool blocked, seen, irq_driven;
    touch_sample_t physical;
} touch_samples_t;

// Caller provides synchronization; this queue contains no hardware or LVGL calls.
void touch_samples_cancel(touch_samples_t *queue, int64_t time_us);
void touch_samples_push(touch_samples_t *queue, int x, int y, bool pressed, bool valid, int64_t time_us);
bool touch_samples_pop(touch_samples_t *queue, touch_sample_t *sample);
