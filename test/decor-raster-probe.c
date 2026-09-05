// Standalone probe for face_draw_decor: star gap, alpha blend, clipping, bounds.
// cc -std=c11 -O2 -Wall -Wextra -Werror -fsanitize=address,undefined test/decor-raster-probe.c firmware/main/face_decor.c -lm
#include "../firmware/main/face_decor.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

#define W 240
#define H 240
static uint16_t buf[W*H];
static int fails;
#define CHECK(cond,...) do{ if(!(cond)){fails++;printf("FAIL: " __VA_ARGS__);printf("\n");} }while(0)

static uint16_t at(float cx,float cy) { // canonical -> pixel
    const float scale=W*.9f/256;
    int x=(int)(W/2.0f+scale*cx),y=(int)(W*.45f+scale*cy);
    return buf[y*W+x];
}
static void star(face_polygon_t *p,float cx,float cy,float outer,float inner) {
    p->count=10;
    for(int i=0;i<10;i++) {
        float a=(float)(i*M_PI/5-M_PI/2),r=i%2?inner:outer;
        p->points[i][0]=cx+r*cosf(a);p->points[i][1]=cy+r*sinf(a);
    }
}
static void square(face_polygon_t *p,float cx,float cy,float half) {
    p->count=4;
    float q[4][2]={{-half,-half},{half,-half},{half,half},{-half,half}};
    for(int i=0;i<4;i++) {p->points[i][0]=cx+q[i][0];p->points[i][1]=cy+q[i][1];}
}
static int r5(uint16_t v){return (v>>11)&31;} static int g6(uint16_t v){return (v>>5)&63;} static int b5(uint16_t v){return v&31;}

int main(void) {
    face_polygon_t items[FACE_DECOR_MAX_ITEMS];
    // 1. Star: centre and arm tip filled, gap between arms untouched.
    memset(buf,0,sizeof buf);
    memset(items,0,sizeof items);
    items[0].color=0xffffff;items[0].alpha=1;star(&items[0],0,0,40,16);
    face_draw_decor(buf,W,H,items,1);
    CHECK(at(0,0)==0xffff,"star centre unfilled");
    CHECK(at(0,-30)==0xffff,"star top arm unfilled %04x",at(0,-30));
    // Gap direction: between top tip (-90deg) and next outer at -54deg lies -72deg; at radius 32 it is outside the star.
    CHECK(at(32*cosf(-72*(float)M_PI/180),32*sinf(-72*(float)M_PI/180))==0,"star gap filled");
    // 2. Alpha overlay: 50% white over black ~ mid grey; 50% red over pure blue keeps blue half.
    memset(buf,0,sizeof buf);
    items[0].alpha=.5f;square(&items[0],0,0,20);
    face_draw_decor(buf,W,H,items,1);
    uint16_t g=at(0,0);
    CHECK(r5(g)==16&&g6(g)==32&&b5(g)==16,"50%% white over black -> %d %d %d",r5(g),g6(g),b5(g));
    for(int i=0;i<W*H;i++) buf[i]=0x001f;
    items[0].color=0xff0000;
    face_draw_decor(buf,W,H,items,1);
    g=at(0,0);
    CHECK(r5(g)==16&&g6(g)==0&&b5(g)==16,"50%% red over blue -> %d %d %d",r5(g),g6(g),b5(g));
    CHECK(at(60,0)==0x001f,"pixel outside square modified");
    // Edge antialiasing: a square edge at half-pixel offset yields partial coverage.
    memset(buf,0,sizeof buf);
    items[0].color=0xffffff;items[0].alpha=1;square(&items[0],0,0,20);
    items[0].points[1][0]=items[0].points[2][0]=20.6f; // right edge lands mid-pixel
    face_draw_decor(buf,W,H,items,1);
    { const float scale=W*.9f/256;int x=(int)floorf(W/2.0f+scale*20.6f),y=(int)(W*.45f);uint16_t e=buf[y*W+x];
      CHECK(e!=0&&e!=0xffff,"edge pixel not antialiased: %04x",e); }
    // 3. Clipping: square straddling canonical y=70 drawn above, not below; square outside circle untouched.
    memset(buf,0,sizeof buf);
    square(&items[0],0,70,20);
    face_draw_decor(buf,W,H,items,1);
    CHECK(at(0,60)==0xffff,"above y=70 clip unfilled");
    CHECK(at(0,75)==0,"below y=70 clip filled");
    CHECK(at(0,85)==0,"status label region touched");
    memset(buf,0,sizeof buf);
    square(&items[0],110,0,8); // entirely outside radius 100
    face_draw_decor(buf,W,H,items,1);
    int any=0;for(int i=0;i<W*H;i++) any|=buf[i];
    CHECK(!any,"polygon outside circle painted");
    memset(buf,0,sizeof buf);
    square(&items[0],95,0,20); // straddles circle edge
    face_draw_decor(buf,W,H,items,1);
    CHECK(at(90,0)==0xffff,"inside circle edge unfilled");
    CHECK(at(105,0)==0,"outside circle edge filled");
    // Positioned decorations leave no pixels at the old origin.
    memset(buf,0,sizeof buf);
    square(&items[0],0,0,5);
    face_draw_decor_positioned(buf,W,H,items,1,-40,47);
    CHECK(at(-40,47)==0xffff,"positioned decoration missing");
    CHECK(at(0,0)==0,"positioned decoration left pixels at its old origin");
    face_draw_decor_positioned(buf,W,H,items,1,NAN,47);
    face_draw_decor_positioned(buf,W,H,items,1,0,NAN);
    // 4. Bounds: huge/off-screen polygons, max items, bad inputs (ASan guards the buffer).
    memset(buf,0,sizeof buf);
    for(int i=0;i<FACE_DECOR_MAX_ITEMS;i++) {items[i]=items[0];square(&items[i],(i%6-3)*60.f,(i/6-2)*60.f,500);items[i].alpha=.3f;}
    face_draw_decor(buf,W,H,items,FACE_DECOR_MAX_ITEMS);
    face_draw_decor(buf,W,H,items,FACE_DECOR_MAX_ITEMS+5);
    items[0].count=2;face_draw_decor(buf,W,H,items,1);
    items[0].count=FACE_DECOR_MAX_POINTS+1;face_draw_decor(buf,W,H,items,1);
    items[0].count=4;items[0].points[0][0]=NAN;face_draw_decor(buf,W,H,items,1);
    face_draw_decor(NULL,W,H,items,1);face_draw_decor(buf,0,0,items,1);face_draw_decor(buf,W,H,NULL,1);
    face_draw_decor(buf,W,12,items,1); // buffer shorter than clip region
    printf(fails?"%d check(s) failed\n":"all decor raster checks passed\n",fails);
    return fails!=0;
}
