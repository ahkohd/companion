#include "face_decor.h"
#include <math.h>
#include <stddef.h>

#define DECOR_MAX_WIDTH 512
#define DECOR_CLIP_Y 70.0f

static float clampf01(float x) { return fminf(1, fmaxf(0, x)); }

static uint16_t blend565(uint16_t dst, int r8, int g8, int b8, float a) {
    int dr=(dst>>11)&31,dg=(dst>>5)&63,db=dst&31;
    dr=(dr<<3)|(dr>>2);dg=(dg<<2)|(dg>>4);db=(db<<3)|(db>>2);
    int r=(int)(dr+(r8-dr)*a+.5f),g=(int)(dg+(g8-dg)*a+.5f),b=(int)(db+(b8-db)*a+.5f);
    return (uint16_t)(((r>>3)<<11)|((g>>2)<<5)|(b>>3));
}

void face_draw_decor(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count) {
    face_draw_decor_shifted(pixels,width,height,items,count,0);
}

void face_draw_decor_shifted(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, float offset_y) {
    face_draw_decor_positioned(pixels,width,height,items,count,0,offset_y);
}

static void draw_decor_scaled(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, float offset_x, float offset_y, int face_scale);

void face_draw_decor_positioned(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, float offset_x, float offset_y) {
    draw_decor_scaled(pixels,width,height,items,count,offset_x,offset_y,100);
}
void face_draw_decor_scaled(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, int face_scale) {
    draw_decor_scaled(pixels,width,height,items,count,0,0,face_scale);
}
static void draw_decor_scaled(uint16_t *pixels, int width, int height, const face_polygon_t *items, int count, float offset_x, float offset_y, int face_scale) {
    if(!pixels||!items||width<=0||height<=0||width>DECOR_MAX_WIDTH||!isfinite(offset_x)||!isfinite(offset_y)||face_scale<50||face_scale>150) return;
    if(count>FACE_DECOR_MAX_ITEMS) count=FACE_DECOR_MAX_ITEMS;
    const float scale=width*.9f/256*(face_scale/100.0f),cx=width/2.0f+scale*offset_x,cy=width*.45f+scale*offset_y,radius=scale*100;
    const float clip_bottom=fminf((float)height,cy+scale*DECOR_CLIP_Y);
    float cover[DECOR_MAX_WIDTH];
    for(int item=0;item<count;item++) {
        const face_polygon_t *p=&items[item];
        int n=p->count;
        float alpha=clampf01(p->alpha);
        if(n<3||n>FACE_DECOR_MAX_POINTS||alpha<=0) continue;
        const int r8=(p->color>>16)&255,g8=(p->color>>8)&255,b8=p->color&255;
        float px[FACE_DECOR_MAX_POINTS],py[FACE_DECOR_MAX_POINTS],min_y=(float)height,max_y=0;
        int valid=1;
        for(int i=0;i<n;i++) {
            px[i]=cx+scale*p->points[i][0];py[i]=cy+scale*p->points[i][1];
            if(!isfinite(px[i])||!isfinite(py[i])) valid=0;
            min_y=fminf(min_y,py[i]);max_y=fmaxf(max_y,py[i]);
        }
        if(!valid) continue;
        int start=(int)fmaxf(0,floorf(fmaxf(min_y,cy-radius))),end=(int)fminf(fminf((float)height,ceilf(max_y)),ceilf(clip_bottom));
        for(int y=start;y<end;y++) {
            int x0=width,x1=0;
            for(int sample=0;sample<2;sample++) {
                float scan=y+.25f+sample*.5f;
                if(scan>clip_bottom) continue;
                float dy=scan-cy,radius2=radius*radius-dy*dy;
                if(radius2<=0) continue;
                float extent=sqrtf(radius2),clip_l=cx-extent,clip_r=cx+extent;
                if(face_scale!=100) {
                    float screen_y=scan-height/2.0f,screen_radius=fminf(width,height)/2.0f;
                    float edge=sqrtf(fmaxf(0,screen_radius*screen_radius-screen_y*screen_y));
                    clip_l=fmaxf(clip_l,width/2.0f-edge);clip_r=fminf(clip_r,width/2.0f+edge);
                }
                // Sorted scanline intersections, half-open rule so shared vertices count once.
                float xs[FACE_DECOR_MAX_POINTS];int m=0;
                for(int i=0;i<n;i++) {
                    int j=(i+1)%n;
                    if((py[i]<=scan&&py[j]>scan)||(py[j]<=scan&&py[i]>scan)) {
                        float x=px[i]+(scan-py[i])*(px[j]-px[i])/(py[j]-py[i]);int k=m++;
                        while(k>0&&xs[k-1]>x) {xs[k]=xs[k-1];k--;}
                        xs[k]=x;
                    }
                }
                for(int s=0;s+1<m;s+=2) { // even-odd: fill between pairs
                    float l=fmaxf(xs[s],clip_l),r=fminf(xs[s+1],clip_r);
                    if(r<=l) continue;
                    int a=(int)fmaxf(0,floorf(l)),b=(int)fminf(width,ceilf(r));
                    if(a>=b) continue;
                    if(x0>=x1) {
                        for(int x=a;x<b;x++) cover[x]=0;
                        x0=a;x1=b;
                    } else {
                        if(a<x0) {for(int x=a;x<x0;x++) cover[x]=0;x0=a;}
                        if(b>x1) {for(int x=x1;x<b;x++) cover[x]=0;x1=b;}
                    }
                    for(int x=a;x<b;x++) cover[x]+=clampf01(fminf(x+1,r)-fmaxf(x,l))*.5f;
                }
            }
            if(x0>=x1) continue;
            uint16_t *row=pixels+(size_t)y*width;
            for(int x=x0;x<x1;x++) {
                float a=cover[x]*alpha;
                if(a<=0) continue;
                row[x]=a>=1?(uint16_t)(((r8>>3)<<11)|((g8>>2)<<5)|(b8>>3)):blend565(row[x],r8,g8,b8,a);
            }
        }
    }
}
