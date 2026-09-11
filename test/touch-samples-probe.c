#include "touch_samples.h"
#include "module_touch.h"
#include <assert.h>
#include <stdio.h>

static module_touch_action_t drain(touch_samples_t *queue)
{
    module_touch_t contact = {0};
    touch_sample_t sample;
    module_touch_action_t result = MODULE_TOUCH_NONE;

    while (touch_samples_pop(queue, &sample)) {
        if (!sample.valid) {
            contact.active = false;
            continue;
        }

        if (sample.pressed) {
            if (!contact.active)
                module_touch_begin(&contact, sample.x, sample.y, sample.time_us);
            else
                module_touch_move(&contact, sample.x, sample.y);
        } else
            result = module_touch_end(&contact, sample.x, sample.y, sample.time_us);
    }

    return result;
}

int main(void)
{
    touch_samples_t queue = {0};
    // Physical swipe completes before LVGL drains anything; timestamps/trajectory survive.
    touch_samples_push(&queue, 300, 233, true, true, 1000);
    touch_samples_push(&queue, 270, 233, true, true, 9000);
    touch_samples_push(&queue, 220, 233, true, true, 17000);
    touch_samples_push(&queue, 0, 0, false, true, 25000);

    assert(drain(&queue) == MODULE_TOUCH_NEXT);

    // Fast tap remains a tap even if replay is delayed arbitrarily.
    touch_samples_push(&queue, 233, 233, true, true, 33000);
    touch_samples_push(&queue, 0, 0, false, true, 41000);

    assert(drain(&queue) == MODULE_TOUCH_TAP);

    // Identical held points do not fill the ring, and release retains physical duration.

    for (int i = 0; i < 300; ++i)
        touch_samples_push(&queue, 200, 200, true, true, 49000 + i * 8000);
    touch_samples_push(&queue, 0, 0, false, true, 49000 + 300 * 8000);

    assert(queue.revision == 0);
    assert(queue.count == 2);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    // Too much undrained motion cancels everything, never turns the tail into a tap.
    queue = (touch_samples_t){0};

    for (int i = 0; i < TOUCH_SAMPLE_CAPACITY + 10; ++i)
        touch_samples_push(&queue, i, 200, true, true, 1000 + i * 8000);

    assert(queue.revision == 1);
    assert(queue.blocked);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    touch_samples_push(&queue, 0, 0, false, true, 1200000);
    touch_samples_push(&queue, 100, 100, true, true, 1208000);
    touch_samples_push(&queue, 0, 0, false, true, 1216000);

    assert(drain(&queue) == MODULE_TOUCH_TAP);

    // I/O errors and multiple contacts (valid=false) cancel until a clean release.
    queue = (touch_samples_t){0};
    touch_samples_push(&queue, 100, 100, true, true, 1000);
    touch_samples_push(&queue, 0, 0, false, false, 9000);
    touch_samples_push(&queue, 200, 100, true, true, 17000);

    assert(queue.blocked);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    touch_samples_push(&queue, 0, 0, false, true, 25000);

    assert(!queue.blocked);

    // Worker starvation is also uncertain: don't convert a missed swipe into a tap.
    queue = (touch_samples_t){0};
    touch_samples_push(&queue, 100, 100, true, true, 1000);
    touch_samples_push(&queue, 0, 0, false, true, 100000);

    assert(queue.revision == 1);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    // Rotation discards every queued completed contact, not only the first release.
    queue = (touch_samples_t){0};
    touch_samples_push(&queue, 100, 100, true, true, 1000);
    touch_samples_push(&queue, 0, 0, false, true, 9000);
    touch_samples_push(&queue, 200, 200, true, true, 17000);
    touch_samples_push(&queue, 0, 0, false, true, 25000);
    touch_samples_cancel(&queue, 26000);

    assert(queue.count == 1 && queue.revision == 1);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    // IRQ-driven controllers legitimately emit no events while a finger is stationary.
    queue = (touch_samples_t){.irq_driven = true};
    touch_samples_push(&queue, 200, 200, true, true, 1000);
    touch_samples_push(&queue, 0, 0, false, true, 401000);

    assert(queue.revision == 0);
    assert(drain(&queue) == MODULE_TOUCH_TAP);

    touch_samples_push(&queue, 200, 200, true, true, 901000);
    touch_samples_push(&queue, 0, 0, false, true, 1901000);

    assert(queue.revision == 0);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    // A late/coalesced IRQ release is ambiguous and cannot re-enable a partial contact.
    queue = (touch_samples_t){.irq_driven = true};
    touch_samples_push(&queue, 200, 200, true, true, 1000);
    touch_samples_cancel(&queue, 9000);
    touch_samples_push(&queue, 0, 0, false, false, 9000);
    touch_samples_push(&queue, 300, 200, true, true, 17000);

    assert(queue.blocked);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    touch_samples_push(&queue, 0, 0, false, true, 25000);

    assert(!queue.blocked);
    assert(drain(&queue) == MODULE_TOUCH_NONE);

    puts("touch sample checks passed");
}
