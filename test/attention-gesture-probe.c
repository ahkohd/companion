#include "attention_gesture.h"
#include <assert.h>
#include <string.h>
int main(void) {
    attention_snapshot_t a = {.active=true,.detail=true,.id="request",.revision=1};
    attention_gesture_t g = {0};
    attention_gesture_press(&g, 0);
    assert(!attention_gesture_tap(&g,&a,0,100,320,10000,"approve"));
    assert(!attention_gesture_poll(&g,&a,0,300000));
    assert(!strcmp(attention_gesture_poll(&g,&a,0,310000),"approve"));
    assert(!attention_gesture_poll(&g,&a,0,400000));
    attention_gesture_press(&g, 500000);
    assert(!attention_gesture_tap(&g,&a,0,100,320,510000,"approve"));
    attention_gesture_press(&g, 800000);
    assert(!attention_gesture_poll(&g,&a,0,820000));
    assert(attention_gesture_tap(&g,&a,0,105,322,870000,"approve"));
    assert(!attention_gesture_poll(&g,&a,0,1200000));
    attention_gesture_press(&g, 1300000);
    assert(!attention_gesture_tap(&g,&a,0,200,200,1310000,NULL));
    attention_gesture_press(&g, 1400000);
    assert(attention_gesture_tap(&g,&a,0,200,200,1410000,NULL));
    attention_gesture_press(&g, 1500000);
    assert(!attention_gesture_tap(&g,&a,0,100,320,1510000,"approve"));
    a.revision++;
    assert(!attention_gesture_poll(&g,&a,0,1900000));
    attention_gesture_press(&g, 2000000);
    assert(!attention_gesture_tap(&g,&a,0,100,320,2010000,"approve"));
    assert(!attention_gesture_poll(&g,&a,1,2400000));
    attention_gesture_press(&g, 2500000);
    assert(!attention_gesture_tap(&g,&a,0,100,320,2510000,"approve"));
    attention_gesture_cancel(&g);
    assert(!attention_gesture_poll(&g,&a,0,2900000));
    attention_gesture_press(&g, 3000000);
    assert(!attention_gesture_tap(&g,&a,0,100,320,3010000,"approve"));
    a.active=false;
    assert(!attention_gesture_poll(&g,&a,0,3400000));
    a.active=true;
    attention_gesture_press(&g, 3500000);
    assert(!attention_gesture_tap(&g,&a,0,100,100,3510000,"approve"));
    attention_gesture_press(&g, 3600000);
    assert(!attention_gesture_tap(&g,&a,0,139,139,3610000,"approve"));
    assert(!attention_gesture_poll(&g,&a,0,3800000));
    assert(!strcmp(attention_gesture_poll(&g,&a,0,3910000),"approve"));
    return 0;
}
