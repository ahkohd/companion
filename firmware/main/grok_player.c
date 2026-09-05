#include "grok_player.h"
#include "device_palette.h"
#include "grok_codec.h"
#include <math.h>
#include <string.h>

static uint16_t u16(const uint8_t *p) {return (uint16_t)(p[0]|p[1]<<8);}
static uint32_t u32(const uint8_t *p) {return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
bool grok_player_open(grok_player_t *p,const uint8_t *data,size_t length,uint16_t *pixels) {
    if(!p) return false;
    *p=(grok_player_t){.index=-1};
    if(!data||!pixels||length<24||u32(data)!=0x31435247||u16(data+4)!=GROK_WIDTH||u16(data+6)!=GROK_HEIGHT)return false;
    uint32_t count=u32(data+12),loop=u32(data+16);
    uint16_t fps=u16(data+8),key=u16(data+10);
    if(fps<1||fps>60||key<1||key>60||count<1||count>3600||u32(data+20)!=count||(loop!=UINT32_MAX&&loop>=count)||length<24+(count+2)*4)return false;
    uint32_t previous=24+(count+2)*4;
    for(uint32_t i=0;i<=count+1;i++) {uint32_t offset=u32(data+24+i*4);if(offset<previous||offset>length)return false;previous=offset;}
    if(previous!=length)return false;
    *p=(grok_player_t){.data=data,.length=length,.pixels=pixels,.count=count,.loop=loop,.fps=fps,.key=key,.index=-1};
    return true;
}
bool grok_player_sample(grok_player_t *p,double age,bool still) {
    if(!p||!p->data||!p->pixels)return false;
    double tick=floor(fmax(0,isfinite(age)?age:0)*p->fps);
    int target=still?(int)p->count:tick<p->count?(int)tick:p->loop==UINT32_MAX?(int)p->count-1:(int)(p->loop+fmod(tick-p->count,p->count-p->loop));
    if(target==p->index)return true;
    int key=target==(int)p->count?target:target/p->key*p->key;
    if(p->index<key||p->index>target||p->index==(int)p->count) {memset(p->pixels,0,GROK_PIXELS*sizeof(uint16_t));p->index=key-1;}
    while(p->index<target) {
        uint32_t i=(uint32_t)(p->index+1),start=u32(p->data+24+i*4),end=u32(p->data+28+i*4);
        if(!grok_decode(p->data+start,end-start,p->pixels,GROK_PIXELS)) {p->data=NULL;p->index=-1;return false;}
        p->index=(int)i;
    }
    uint32_t hash=2166136261u;
    for(int i=0;i<GROK_PIXELS;i++)hash=(hash^p->pixels[i])*16777619u;
    p->hash=hash;
    return true;
}
static uint16_t mix565(uint16_t a,uint16_t b,uint16_t c,uint16_t d,int fx,int fy) {
    if(a==b&&a==c&&a==d)return a;
    uint16_t out=0;
    static const int shifts[]={11,5,0},masks[]={31,63,31};
    for(int i=0;i<3;i++) {
        int s=shifts[i],m=masks[i];
        int top=((a>>s)&m)*(256-fx)+((b>>s)&m)*fx,bottom=((c>>s)&m)*(256-fx)+((d>>s)&m)*fx;
        out|=(uint16_t)(((top*(256-fy)+bottom*fy+32768)>>16)<<s);
    }
    return out;
}
void grok_blit(const uint16_t *source,uint16_t *pixels,int width,int height,double x,double y) {
    grok_blit_scaled(source,pixels,width,height,x,y,100);
}
void grok_blit_scaled(const uint16_t *source,uint16_t *pixels,int width,int height,double x,double y,int face_scale) {
    grok_blit_themed(source,pixels,width,height,x,y,face_scale,0,0xffffff);
}
void grok_blit_themed(const uint16_t *source,uint16_t *pixels,int width,int height,double x,double y,int face_scale,uint32_t background,uint32_t foreground) {
    if(!source||!pixels||width<1||width>512||height<1||height>512||!isfinite(x)||!isfinite(y)||fabs(x)>2||fabs(y)>2||face_scale<50||face_scale>150)return;
    uint16_t bg = device_rgb565(background);
    if (!bg) memset(pixels,0,(size_t)width*height*sizeof(uint16_t));
    else for (int i=0; i<width*height; ++i) pixels[i]=bg;
    static uint16_t palette[64];
    static uint32_t last_bg=UINT32_MAX,last_fg=UINT32_MAX;
    bool themed = background != 0 || foreground != 0xffffff;
    if (themed && (background!=last_bg || foreground!=last_fg)) {
        for (unsigned i=0;i<64;++i) palette[i]=device_face_pixel((uint16_t)(((i>>1)<<11)|(i<<5)|(i>>1)),background,foreground);
        last_bg=background;last_fg=foreground;
    }
    const double scale=width*.9/256*(face_scale/100.0),unit=200.0/GROK_WIDTH;
    // Q16 samples remove software double arithmetic from the frame's pixel loops.
    int step=(int)floor(65536/(scale*unit)+.5);
    int sx=(int)floor(((((.5-width/2.0-x*5*scale)/scale+100)/unit)-.5)*65536+.5);
    int64_t sy=(int64_t)floor(((((.5-width*.45-y*5*scale)/scale+100)/unit)-.5)*65536+.5);
    static int cached_width=0,cached_height=0,cached_scale=0,left[512],right[512],ix[512],fx[512];
    if(cached_width!=width||cached_height!=height||cached_scale!=face_scale) {
        for(int dy=0;dy<height;dy++) {
            double ry=(dy+.5-width*.45)/scale;
            left[dy]=right[dy]=0;
            if(ry>70||fabs(ry)>=100)continue;
            double extent=sqrt(10000-ry*ry)*scale;
            left[dy]=(int)fmax(0,ceil(width/2.0-extent-.5));
            right[dy]=(int)fmin(width,floor(width/2.0+extent-.5)+1);
            if(face_scale!=100) {
                double screen_y=dy+.5-height/2.0,radius=fmin(width,height)/2.0;
                double edge=sqrt(fmax(0,radius*radius-screen_y*screen_y));
                left[dy]=(int)fmax(left[dy],ceil(width/2.0-edge-.5));
                right[dy]=(int)fmin(right[dy],floor(width/2.0+edge-.5)+1);
            }
        }
        cached_width=width;cached_height=height;cached_scale=face_scale;
    }
    for(int dx=0;dx<width;dx++,sx+=step) {ix[dx]=sx>>16;fx[dx]=(sx>>8)&255;}
    for(int dy=0;dy<height;dy++,sy+=step) {
        int iy=(int)(sy>>16),fy=(int)((sy>>8)&255);
        if(iy<0||iy>=GROK_HEIGHT-1)continue;
        const uint16_t *row=source+iy*GROK_WIDTH;
        uint16_t *dst=pixels+(size_t)dy*width;
        for(int dx=left[dy];dx<right[dy];dx++) {
            int k=ix[dx];if(k<0||k>=GROK_WIDTH-1)continue;
            uint16_t a=row[k],b=row[k+1],c=row[k+GROK_WIDTH],d=row[k+GROK_WIDTH+1];
            if((a|b|c|d)==0)continue;
            uint16_t pixel=mix565(a,b,c,d,fx[dx],fy);
            unsigned r=pixel>>11,g=(pixel>>5)&63,blue=pixel&31;
            dst[dx]=themed && r==blue && (g>>1)==r ? palette[g] : pixel;
        }
    }
}
