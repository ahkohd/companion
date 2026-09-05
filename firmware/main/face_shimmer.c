#include "face_shimmer.h"
#include <math.h>
#include <stddef.h>

static uint32_t shimmer_color(double t, double u, bool reduced, uint32_t base, uint32_t peak) {
    // Constants mirror shared/shimmer.json; native/browser parity tests guard them.
    double strength=0;
    if (!reduced && isfinite(t) && isfinite(u) && t>=0) {
        double phase=fmod(t,2.8);
        if (phase<1.6) {
            double centre=-.24+1.48*phase/1.6;
            double distance=fabs(u-centre)/.24;
            if (distance<1) strength=(1+cos(3.141592653589793*distance))/2;
        }
    }
    unsigned r=(unsigned)floor((base>>16)+((double)(peak>>16)-(base>>16))*strength+.5);
    unsigned g=(unsigned)floor(((base>>8)&255)+((double)((peak>>8)&255)-((base>>8)&255))*strength+.5);
    unsigned b=(unsigned)floor((base&255)+((double)(peak&255)-(base&255))*strength+.5);
    return (r<<16)|(g<<8)|b;
}

uint32_t face_shimmer_color(double t, double u, bool reduced) {
    return shimmer_color(t,u,reduced,0x9c95ad,0xf5efff);
}

uint32_t face_name_shimmer_color(double t, double u, bool reduced) {
    return shimmer_color(t,u,reduced,0x7e768c,0xb6aec5);
}

int face_shimmer_blit_palette(const uint16_t *mask, int mw, int mh, uint16_t *pixels,
                     int width, int height, int left, int top, double t, bool reduced,
                     uint32_t base, uint32_t peak) {
    if (!mask || !pixels || mw<=0 || mh<=0 || width<=0 || height<=0) return 0;
    int first=mw,last=-1;
    for (int y=0;y<mh;y++) for (int x=0;x<mw;x++) if (mask[(size_t)y*mw+x]) {
        if (x<first) first=x;
        if (x>last) last=x;
    }
    int count=0;
    for (int x=first;x<=last;x++) {
        int dx=left+x;
        if (dx<0 || dx>=width) continue;
        uint32_t color=shimmer_color(t,last==first?.5:(x-first)/(double)(last-first),reduced,base,peak);
        unsigned r=color>>16,g=(color>>8)&255,b=color&255;
        for (int y=0;y<mh;y++) {
            int dy=top+y;
            if (dy<0 || dy>=height) continue;
            unsigned coverage=(mask[(size_t)y*mw+x]>>5)&63;
            if (!coverage) continue;
            size_t i=(size_t)dy*width+dx;
            unsigned dst=pixels[i],dr=(dst>>11)&31,dg=(dst>>5)&63,db=dst&31;
            dr=(dr<<3)|(dr>>2);dg=(dg<<2)|(dg>>4);db=(db<<3)|(db>>2);
            unsigned rr=(dr*(63-coverage)+r*coverage+31)/63;
            unsigned gg=(dg*(63-coverage)+g*coverage+31)/63;
            unsigned bb=(db*(63-coverage)+b*coverage+31)/63;
            pixels[i]=(uint16_t)(((rr>>3)<<11)|((gg>>2)<<5)|(bb>>3));
            count++;
        }
    }
    return count;
}

int face_shimmer_blit(const uint16_t *mask, int mw, int mh, uint16_t *pixels,
                     int width, int height, int left, int top, double t, bool reduced) {
    return face_shimmer_blit_palette(mask,mw,mh,pixels,width,height,left,top,t,reduced,0x9c95ad,0xf5efff);
}
