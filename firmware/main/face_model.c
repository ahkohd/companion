#include "face_model.h"
#include "device_palette.h"
#include "face_profiles.h"
#include <math.h>
#include <string.h>

static float clamp(float x) { return fminf(1, fmaxf(0, x)); }
static float lerp(float a, float b, float t) { return a + (b - a) * t; }
static float ease(double time, double since, float duration) { float x = 1 - clamp((time - since) / duration); return 1 - x*x*x*x*x; }
static face_profile_t profile_at(const face_motion_t *m, double now) {
    float t = ease(now, m->since, .45f);
    face_profile_t p = m->target;
    for (int i=0;i<3;i++) p.gaze[i] = lerp(m->from.gaze[i],p.gaze[i],t);
    p.split = lerp(m->from.split,p.split,t);
    for (int i=0;i<2;i++) {
        p.eyes[i].w = lerp(m->from.eyes[i].w,p.eyes[i].w,t);
        p.eyes[i].h = lerp(m->from.eyes[i].h,p.eyes[i].h,t);
        p.eyes[i].open = lerp(m->from.eyes[i].open,p.eyes[i].open,t);
        p.eyes[i].tilt = lerp(m->from.eyes[i].tilt,p.eyes[i].tilt,t);
    }
    return p;
}
static float look_component(float from,float target,float velocity,float dt,float decay,float *next_velocity) {
    float offset=from-target,b=velocity+FACE_LOOK_RESPONSE*offset;
    *next_velocity=(velocity-FACE_LOOK_RESPONSE*b*dt)*decay;
    return target+(offset+b*dt)*decay;
}
static face_gaze_t look_sample(const face_motion_t *m,double now,face_gaze_t *velocity) {
    float dt=fmax(0,now-m->look_since);
    *velocity=(face_gaze_t){0};
    if(dt>=FACE_LOOK_SETTLE_SECONDS) return m->look_target;
    float decay=expf(-FACE_LOOK_RESPONSE*dt);
    return (face_gaze_t){
        look_component(m->look_from.x,m->look_target.x,m->look_velocity.x,dt,decay,&velocity->x),
        look_component(m->look_from.y,m->look_target.y,m->look_velocity.y,dt,decay,&velocity->y),
        look_component(m->look_from.mix,m->look_target.mix,m->look_velocity.mix,dt,decay,&velocity->mix)};
}
face_gaze_t face_motion_gaze(const face_motion_t *m,double now) {
    face_gaze_t velocity;return look_sample(m,now,&velocity);
}
void face_motion_init(face_motion_t *m, face_state_t state, double now) {
    *m=(face_motion_t){.state=state,.from=FACE_PROFILES[state],.target=FACE_PROFILES[state],.since=now-.45};
}
void face_motion_state(face_motion_t *m, face_state_t state, double now) {
    if(state==m->state) return;
    m->from=profile_at(m,now); m->target=FACE_PROFILES[state]; m->state=state; m->since=now;
}
void face_motion_look(face_motion_t *m, bool enabled, float x, float y, double now) {
    face_gaze_t next = enabled ? (face_gaze_t){x,y,1} : (face_gaze_t){m->look_target.x,m->look_target.y,0};
    if(next.x==m->look_target.x && next.y==m->look_target.y && next.mix==m->look_target.mix) return;
    face_gaze_t velocity;
    m->look_from=look_sample(m,now,&velocity);m->look_velocity=velocity;m->look_target=next;m->look_since=now;
}
uint32_t face_motion_color(const face_motion_t *m) { return m->target.color; }
static float noise(double t, double period, double seed) {
    double p=t/period*6.283185307179586;
    return .55*sin(p+seed)+.3*sin(2*p+seed*1.7+1.1)+.15*sin(3*p+seed*2.3+2.4);
}
static double random_next(uint32_t *seed) {
    *seed+=0x6d2b79f5;
    uint32_t t=(*seed ^ (*seed >> 15)) * (1 | *seed);
    t=(t+(t ^ (t >> 7)) * (61 | t)) ^ t;
    return (double)(t ^ (t >> 14))/4294967296.0;
}
static float blink(double now) {
    now=fmod(fmod(now,900)+900,900);
    static double starts[600]; static int count;
    if(!count) {
        uint32_t seed=0x5eed; double t=1.4;
        while(t<900 && count<599) {
            starts[count++]=t;t+=1.9+random_next(&seed)*2.7;
            if(random_next(&seed)<.18) { starts[count++]=t;t+=.24; }
        }
    }
    for(int i=0;i<count;i++) {
        if(now<starts[i]) break;
        if(starts[i]+.18>900) continue;
        double k=(now-starts[i])/.18;
        if(k>=0 && k<=1) return k<.45 ? 1-k/.45 : (k-.45)/.55;
    }
    return 1;
}
static void spin(float u[3], float v[3], float degrees) {
    float c=cosf(degrees*.0174532925199433f),s=sinf(degrees*.0174532925199433f);
    for(int i=0;i<3;i++) { float a=u[i],b=v[i];u[i]=a*c+b*s;v[i]=b*c-a*s; }
}
static float round2(float x) { return floorf(x*100+.5f)/100; }
void face_render_eyes(const face_profile_t *p, double now, face_gaze_t look, face_eye_t eyes[2]) {
    float wander=1-look.mix;
    float yaw=lerp(p->gaze[0],look.x*25,look.mix)+(noise(now,11.3,.4)*5.5+noise(now,3.7,2.1)*1.6)*wander;
    float pitch=lerp(p->gaze[1],-look.y*20,look.mix)+(noise(now,9.1,1.3)*4.2+noise(now,4.3,.7)*1.3)*wander;
    float roll=p->gaze[2]+noise(now,13.7,3.2)*2.2*wander;
    float f[3]={0,0,1},right[3]={1,0,0},down[3]={0,1,0};
    spin(f,right,yaw);spin(down,f,pitch);spin(right,down,roll);
    float lid=blink(now),dx=noise(now,7.9,1.9)*.6f,dy=noise(now,5.3,.3)*.7f;
    for(int i=0;i<2;i++) {
        float ef[3],er[3];memcpy(ef,f,sizeof(ef));memcpy(er,right,sizeof(er));spin(ef,er,p->split*(i?1:-1));
        const face_eye_config_t *e=&p->eyes[i];
        float cp=cosf(e->tilt*.0174532925199433f),sp=sinf(e->tilt*.0174532925199433f);
        float k=.06f+.94f*clamp(fminf(lid,e->open));
        eyes[i]=(face_eye_t){.w=e->w*100,.h=e->h*100,.alpha=clamp(ef[2]/.12f),.matrix={
            round2(er[0]*cp+down[0]*sp),round2((er[1]*cp+down[1]*sp)*k),
            round2(-er[0]*sp+down[0]*cp),round2((-er[1]*sp+down[1]*cp)*k),round2(ef[0]*100+dx),round2(ef[1]*100+dy)}};
    }
}
void face_motion_sample(const face_motion_t *m, double now, face_eye_t eyes[2]) {
    face_profile_t p=profile_at(m,now);face_render_eyes(&p,now,face_motion_gaze(m,now),eyes);
}

// Rasterize the same affine capsule paths as the browser, including perspective.
void face_rasterize(uint16_t *pixels, int width, int height, const face_eye_t eyes[2], uint32_t color) {
    face_rasterize_scaled(pixels,width,height,eyes,color,100);
}
void face_rasterize_scaled(uint16_t *pixels, int width, int height, const face_eye_t eyes[2], uint32_t color, int face_scale) {
    face_rasterize_themed(pixels,width,height,eyes,color,face_scale,0);
}
void face_rasterize_themed(uint16_t *pixels, int width, int height, const face_eye_t eyes[2], uint32_t color, int face_scale, uint32_t background) {
    if(!pixels||!eyes||width<1||width>512||height<1||height>512||face_scale<50||face_scale>150)return;
    uint16_t bg=device_rgb565(background);
    if (!bg) memset(pixels,0,(size_t)width*height*sizeof(*pixels));
    else for(int i=0;i<width*height;++i) pixels[i]=bg;
    int br=(bg>>11)&31,bgch=(bg>>5)&63,bb=bg&31;
    const float scale=width*.9f/256*(face_scale/100.0f);
    const int red=(color>>19)&31,green=(color>>10)&63,blue=(color>>3)&31;
    for(int eye=0;eye<2;eye++) {
        const face_eye_t *e=&eyes[eye];
        float radius=fminf(e->w,e->h)/2,px[36],py[36],min_y=height,max_y=0;
        for(int corner=0;corner<4;corner++) for(int step=0;step<9;step++) {
            float angle=(corner*90+step*90.0f/8)*.0174532925199433f;
            float x=(corner==0||corner==3?1:-1)*(e->w/2-radius)+radius*cosf(angle);
            float y=(corner<2?1:-1)*(e->h/2-radius)+radius*sinf(angle);
            int i=corner*9+step;
            px[i]=width/2.0f+scale*(e->matrix[0]*x+e->matrix[2]*y+e->matrix[4]);
            py[i]=width*.45f+scale*(e->matrix[1]*x+e->matrix[3]*y+e->matrix[5]);
            min_y=fminf(min_y,py[i]);max_y=fmaxf(max_y,py[i]);
        }
        int start=(int)fmaxf(0,floorf(min_y)),end=(int)fminf(height,ceilf(max_y));
        for(int y=start;y<end;y++) {
            float left[2]={width,width},right_edge[2]={0,0};
            for(int sample=0;sample<2;sample++) {
                float scan=y+.25f+sample*.5f;
                for(int i=0;i<36;i++) {
                    int j=(i+1)%36;
                    if((py[i]<=scan && py[j]>scan)||(py[j]<=scan && py[i]>scan)) {
                        float x=px[i]+(scan-py[i])*(px[j]-px[i])/(py[j]-py[i]);
                        left[sample]=fminf(left[sample],x);right_edge[sample]=fmaxf(right_edge[sample],x);
                    }
                }
            }
            // Intersect the capsule spans with the same circular clip as the SVG.
            for(int sample=0;sample<2;sample++) {
                float dy=y+.25f+sample*.5f-width*.45f,r=scale*100;
                float radius2=r*r-dy*dy;
                if(radius2<=0) {left[sample]=width;right_edge[sample]=0;continue;}
                float extent=sqrtf(radius2);
                left[sample]=fmaxf(left[sample],width/2.0f-extent);
                right_edge[sample]=fminf(right_edge[sample],width/2.0f+extent);
                if(face_scale!=100) {
                    float screen_y=y+.25f+sample*.5f-height/2.0f,screen_radius=fminf(width,height)/2.0f;
                    float edge=sqrtf(fmaxf(0,screen_radius*screen_radius-screen_y*screen_y));
                    left[sample]=fmaxf(left[sample],width/2.0f-edge);
                    right_edge[sample]=fminf(right_edge[sample],width/2.0f+edge);
                }
            }
            int x0=(int)fmaxf(0,floorf(fminf(left[0],left[1]))),x1=(int)fminf(width,ceilf(fmaxf(right_edge[0],right_edge[1])));
            if(x0>=x1) continue;
            int solid_start=(int)fminf(x1,fmaxf(x0,ceilf(fmaxf(left[0],left[1]))));
            int solid_end=(int)fmaxf(solid_start,fminf(x1,floorf(fminf(right_edge[0],right_edge[1]))));
            uint16_t solid=((int)(br+(red-br)*e->alpha+.5f)<<11)|((int)(bgch+(green-bgch)*e->alpha+.5f)<<5)|(int)(bb+(blue-bb)*e->alpha+.5f);
            uint16_t *row=pixels+y*width;
            // Interior pixels need only a store; coverage is calculated at the edges.
            for(int x=solid_start;x<solid_end;x++) if(bg || solid>row[x]) row[x]=solid;
            for(int side=0;side<2;side++) {
                int a=side?solid_end:x0,b=side?x1:solid_start;
                for(int x=a;x<b;x++) {
                    float coverage=0;
                    for(int sample=0;sample<2;sample++) coverage+=clamp(fminf(x+1,right_edge[sample])-fmaxf(x,left[sample]))*.5f;
                    coverage*=e->alpha;
                    uint16_t pixel=((int)(br+(red-br)*coverage+.5f)<<11)|((int)(bgch+(green-bgch)*coverage+.5f)<<5)|(int)(bb+(blue-bb)*coverage+.5f);
                    if((bg && coverage>0) || pixel>row[x]) row[x]=pixel;
                }
            }
        }
    }
}
