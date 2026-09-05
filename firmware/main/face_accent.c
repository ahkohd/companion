// Native port of web/vendor/grok-bot/motion.ts. See its NOTICE.md and LICENSE.
#include "face_accent.h"
#include <math.h>
#include <string.h>

typedef struct { float x,y,vx,vy,life,size,angle,spin; uint32_t color; int shape; } particle_seed_t;
#include "face_accents.h"
static double clamp(double x) { return fmin(1,fmax(0,x)); }
static float round2(double x) { return floor(x*100+.5)/100; }
static void polygon(face_accent_t *out,double x,double y,double radius,double angle,int shape,uint32_t color,double alpha) {
    face_polygon_t *p=&out->decor[out->count++];
    p->color=color;p->alpha=alpha;p->count=shape==2?10:shape==1?12:4;
    for(int i=0;i<p->count;i++) {
        double a=(angle-90)*3.141592653589793/180+i*6.283185307179586/p->count;
        double k=shape==2 && i%2 ? .42 : 1;
        p->points[i][0]=round2(x+cos(a)*radius*k);p->points[i][1]=round2(y+sin(a)*radius*k);
    }
}
void face_accent_sample(face_state_t state,double age,face_accent_t *out) {
    memset(out,0,sizeof(*out));out->scale=1;
    if(!isfinite(age)||age<0) return;
    if(state==FACE_WORKING) {
        double fade=1-pow(1-clamp(age/.45),3);
        out->rotation=(-9+sin(age*.35)*5)*.6*fade;
        out->x=sin(age*.3)*3*fade;out->y=sin(age*.6)*1.5*fade;
    } else if(state==FACE_DONE) {
        double t=age-.14;
        if(t>=0 && t<.7) {
            double x=t/.7,e=x<.5?4*x*x*x:1-pow(-2*x+2,3)/2;
            out->rotation=360*e;
        }
        double bounce=t-.7;
        for(int i=0;i<4;i++) {
            double height=GROK_BOUNCES[i][0],duration=GROK_BOUNCES[i][1];
            if(bounce>=0 && bounce<duration) {double u=bounce/duration;out->y=-4*height*.38*u*(1-u);break;}
            bounce-=duration;
        }
        double life=age-.94,drag=-60*log(.94),travel=(1-exp(-drag*fmax(0,life)))/drag;
        for(int i=0;i<20;i++) {
            const particle_seed_t *p=&GROK_PARTICLES[i];
            if(life<=0 || life>=p->life) continue;
            double u=life/p->life,alpha=u<.1?u/.1:pow(1-(u-.1)/.9,1.7);
            polygon(out,p->x+p->vx*travel,p->y+p->vy*travel+16/drag*(life-travel),fmax(p->size*(1-u*.4),.5),p->angle+p->spin*life,p->shape,p->color,alpha);
        }
    }
}
void face_accent_eyes(const face_accent_t *accent,face_eye_t eyes[2]) {
    double angle=accent->rotation*3.141592653589793/180;
    double c=cos(angle)*accent->scale,s=sin(angle)*accent->scale;
    for(int i=0;i<2;i++) {
        float *m=eyes[i].matrix;
        for(int j=0;j<6;j+=2) {
            float x=m[j],y=m[j+1];
            m[j]=c*x-s*y+(j==4?accent->x:0);m[j+1]=s*x+c*y+(j==4?accent->y:0);
        }
    }
}
