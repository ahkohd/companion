#include "touch_samples.h"

void touch_samples_cancel(touch_samples_t *queue, int64_t time_us)
{
    ++queue->revision;
    queue->head = 0;
    queue->count = 1;
    queue->samples[0] = (touch_sample_t){.x = queue->physical.x, .y = queue->physical.y, .time_us = time_us, .valid = false};
    queue->blocked = true;
}

void touch_samples_push(touch_samples_t *queue, int x, int y, bool pressed, bool valid, int64_t time_us)
{
    if (!valid) {
        if (!queue->blocked) touch_samples_cancel(queue, time_us);
        queue->physical.time_us = time_us;
        queue->seen = true;
        return;
    }
    if (queue->blocked) {
        if (!pressed) queue->blocked = false;
        queue->physical = (touch_sample_t){.x=x, .y=y, .pressed=pressed, .valid=true, .time_us=time_us};
        queue->seen = true;
        return;
    }
    bool was_pressed = queue->physical.pressed;
    if (queue->seen && (was_pressed || pressed) &&
        (time_us < queue->physical.time_us || (!queue->irq_driven && time_us - queue->physical.time_us > TOUCH_SAMPLE_MAX_GAP_US))) {
        touch_samples_cancel(queue, time_us);
        queue->physical = (touch_sample_t){.x=x, .y=y, .pressed=pressed, .valid=true, .time_us=time_us};
        return;
    }
    // Release retains the final measured point; driver release packets have no valid position.
    if (!pressed) { x = queue->physical.x; y = queue->physical.y; }
    bool changed = was_pressed != pressed || (pressed && (x != queue->physical.x || y != queue->physical.y));
    queue->physical = (touch_sample_t){.x=x, .y=y, .pressed=pressed, .valid=true, .time_us=time_us};
    queue->seen = true;
    if (!changed) return;
    if (queue->count == TOUCH_SAMPLE_CAPACITY) { touch_samples_cancel(queue, time_us); return; }
    unsigned tail = (queue->head + queue->count) % TOUCH_SAMPLE_CAPACITY;
    queue->samples[tail] = queue->physical;
    ++queue->count;
}

bool touch_samples_pop(touch_samples_t *queue, touch_sample_t *sample)
{
    if (!queue->count) return false;
    *sample = queue->samples[queue->head];
    queue->head = (queue->head + 1) % TOUCH_SAMPLE_CAPACITY;
    --queue->count;
    return true;
}
