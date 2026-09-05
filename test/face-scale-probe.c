#include "face_model.h"
#include "face_decor.h"
#include "grok_player.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
#define W 466
static uint16_t before[W*W],after[W*W],source[GROK_PIXELS];
static int lit(const uint16_t *pixels) {int count=0;for(int i=0;i<W*W;i++)if(pixels[i])count++;return count;}
int main(void) {
    face_eye_t eyes[2]={{.w=30,.h=40,.matrix={1,0,0,1,-25,0},.alpha=1},{.w=30,.h=40,.matrix={1,0,0,1,25,0},.alpha=1}};
    face_polygon_t decor={.color=0xff00ff,.alpha=1,.count=4,.points={{-10,30},{10,30},{10,50},{-10,50}}};
    face_rasterize(before,W,W,eyes,0xffffff);face_draw_decor(before,W,W,&decor,1);
    face_rasterize_scaled(after,W,W,eyes,0xffffff,100);face_draw_decor_scaled(after,W,W,&decor,1,100);
    assert(memcmp(before,after,sizeof before)==0);
    int previous=0;
    for(int scale=50;scale<=150;scale+=25) {
        face_rasterize_scaled(after,W,W,eyes,0xffffff,scale);face_draw_decor_scaled(after,W,W,&decor,1,scale);
        int count=lit(after);assert(count>previous);previous=count;
        for(int y=0;y<W;y++)for(int x=0;x<W;x++)if((x-233)*(x-233)+(y-233)*(y-233)>235*235)assert(after[y*W+x]==0);
    }
    face_rasterize_scaled(after,W,W,eyes,0xffffff,100);face_draw_decor_scaled(after,W,W,&decor,1,100);assert(memcmp(before,after,sizeof before)==0);
    for(int i=0;i<GROK_PIXELS;i++)source[i]=0xffff;
    grok_blit(source,before,W,W,.4,-.2);
    grok_blit_scaled(source,after,W,W,.4,-.2,50);grok_blit_scaled(source,after,W,W,.4,-.2,150);grok_blit_scaled(source,after,W,W,.4,-.2,100);
    assert(memcmp(before,after,sizeof before)==0);
    puts("Face and Grok scale defaults, bounds, growth and cache reset passed");
    return 0;
}
