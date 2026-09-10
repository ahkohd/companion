#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "device_palette.h"
#include "display_module.h"
#include "face_model.h"
int main(void) {
    cJSON *json=cJSON_Parse("{\"theme\":\"light\"}"); module_snapshot_t module;
    assert(display_module_parse(json,&module)); assert(module.light_theme);
    assert(module.palette.background==0xffffff && module.palette.foreground==0x171717); cJSON_Delete(json);
    module_design_t design;
    for (int kind=DISPLAY_FACE;kind<=DISPLAY_ROON;++kind) {
        module.kind=kind; display_module_design(&module,&design);
        uint32_t text=kind==DISPLAY_FACE?design.face.textColor:kind==DISPLAY_USAGE?design.usage.textColor:
            kind==DISPLAY_HEY?design.hey.textColor:kind==DISPLAY_CLOCK?design.clock.textColor:design.roon.textColor;
        assert(text==0x171717);
    }
    module.kind=DISPLAY_CLOCK;module.has_design=true;module_design_default(DISPLAY_CLOCK,&module.design);
    module.design.clock.textColor=0x123456;display_module_design(&module,&design);assert(design.clock.textColor==0x123456);
    static uint16_t dark[466*466],light[466*466];
    face_motion_t motion; face_eye_t eyes[2];
    face_motion_init(&motion,FACE_IDLE,0); face_motion_sample(&motion,1,eyes);
    face_rasterize_scaled(dark,466,466,eyes,0xffffff,100);
    face_rasterize_themed(light,466,466,eyes,0,100,0xffffff);
    unsigned ink=0,background=0;
    for(unsigned i=0;i<466*466;i++) {
        if(dark[i]==0) {assert(light[i]==0xffff); background++;}
        if(dark[i]==0xffff) {assert(light[i]==0);ink++;}
    }
    assert(ink>100 && background>1000);
    puts("palette and raster checks passed");
}
