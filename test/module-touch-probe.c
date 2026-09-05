#include <assert.h>
#include <stdio.h>
#include "module_touch.h"

int main(void)
{
    module_touch_t touch = {0};
    assert(module_touch_rect(63, 83, 63, 83, 340, 150));
    assert(module_touch_rect(402, 232, 63, 83, 340, 150));
    assert(!module_touch_rect(403, 232, 63, 83, 340, 150));
    assert(!module_touch_rect(402, 233, 63, 83, 340, 150));
    assert(!module_touch_rect(62, 83, 63, 83, 340, 150));
    assert(!module_touch_rect(63, 83, 63, 83, 0, 150));
    assert(module_touch_end(&touch, 0, 0, 0) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 233, 233, 1000);
    assert(module_touch_end(&touch, 236, 239, 101000) == MODULE_TOUCH_TAP);
    assert(module_touch_end(&touch, 236, 239, 102000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 300, 233, 1000);
    assert(module_touch_end(&touch, 200, 250, 301000) == MODULE_TOUCH_NEXT);
    assert(module_touch_end(&touch, 200, 250, 302000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 100, 233, 1000);
    assert(module_touch_end(&touch, 200, 200, 301000) == MODULE_TOUCH_PREVIOUS);
    module_touch_begin(&touch, 200, 100, 1000);
    assert(module_touch_end(&touch, 270, 200, 301000) == MODULE_TOUCH_PAGE_PREVIOUS);
    assert(module_touch_end(&touch, 270, 200, 302000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 300, 1000);
    assert(module_touch_end(&touch, 190, 245, 301000) == MODULE_TOUCH_PAGE_NEXT);
    assert(module_touch_end(&touch, 190, 245, 302000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 300, 1000);
    assert(module_touch_end(&touch, 200, 246, 301000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 300, 1000);
    assert(module_touch_end(&touch, 240, 250, 301000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 300, 1000);
    assert(module_touch_end(&touch, 200, 200, 1501001) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 200, 1000);
    module_touch_move(&touch, 250, 220);
    assert(module_touch_end(&touch, 200, 200, 301000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 200, 1000);
    assert(module_touch_end(&touch, 200, 200, 701000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 200, 1000);
    assert(module_touch_end(&touch, 100, 200, 2001000) == MODULE_TOUCH_NONE);
    module_touch_begin(&touch, 200, 200, 1000);
    assert(module_touch_end(&touch, 200, 200, 0) == MODULE_TOUCH_NONE);
    for (int size = 32; size <= 72; size++) {
        assert(module_touch_roon(233, 365 + size / 2, 365, size, 32, true, true) == 2);
        assert(module_touch_roon(233 - size - 32, 365 + size / 2, 365, size, 32, true, true) == 1);
        assert(module_touch_roon(233 + size + 32, 365 + size / 2, 365, size, 32, true, true) == 3);
        assert(module_touch_roon(233 - size - 32, 365 + size / 2, 365, size, 32, false, true) == 0);
        assert(module_touch_roon(233 + size + 32, 365 + size / 2, 365, size, 32, true, false) == 0);
        assert(module_touch_roon(233, 364, 365, size, 32, true, true) == 0);
        assert(module_touch_roon(233 + size / 2, 365, 365, size, 32, true, true) == 0);
    }
    assert(module_touch_roon_art(233, 165, 70, 190, 16, false));
    assert(!module_touch_roon_art(138, 70, 70, 190, 16, false));
    assert(module_touch_roon_art(154, 70, 70, 190, 16, false));
    assert(!module_touch_roon_art(233, 260, 70, 190, 16, false));
    assert(module_touch_roon_art(233, 233, 70, 190, 16, true));
    assert(module_touch_roon_art(233, 18, 70, 190, 16, true));
    assert(!module_touch_roon_art(18, 18, 70, 190, 16, true));
    assert(!module_touch_roon_art(233, 448, 70, 190, 16, true));
    assert(module_touch_roon_art(233, 387, 70, 190, 16, true));
    module_touch_begin(&touch, 300, 233, 1000);
    assert(module_touch_end(&touch, 200, 233, 101000) == MODULE_TOUCH_NEXT);
    puts("touch checks passed");
    return 0;
}
