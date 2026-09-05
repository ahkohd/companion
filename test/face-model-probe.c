#include "face_model.h"
#include "face_profiles.h"
#include <stdio.h>
#include <stdlib.h>

static void print_eyes(const face_eye_t eyes[2]) {
    printf("[");
    for(int i=0;i<2;i++) {
        const face_eye_t *e=&eyes[i];
        printf("%s{\"w\":%.6f,\"h\":%.6f,\"alpha\":%.6f,\"matrix\":[",i?",":"",e->w,e->h,e->alpha);
        for(int j=0;j<6;j++) printf("%s%.6f",j?",":"",e->matrix[j]);
        printf("]}");
    }
    puts("]");
}
int main(int argc,char **argv) {
    face_motion_t motion;face_motion_init(&motion,FACE_IDLE,0);
    face_eye_t eyes[2];
    if(argc==3) {
        int state=atoi(argv[1]);double now=atof(argv[2]);
        if(state<0 || state>=FACE_STATE_COUNT) return 2;
        face_render_eyes(&FACE_PROFILES[state],now,(face_gaze_t){0},eyes);
        uint16_t *pixels=calloc(466*466,sizeof(uint16_t));
        if(!pixels) return 3;
        face_rasterize(pixels,466,466,eyes,FACE_PROFILES[state].color);
        printf("P6\n466 466\n255\n");
        for(int i=0;i<466*466;i++) {
            unsigned char rgb[3]={(pixels[i]>>11)*255/31,((pixels[i]>>5)&63)*255/63,(pixels[i]&31)*255/31};
            fwrite(rgb,1,3,stdout);
        }
        free(pixels);return 0;
    }
    char command;int state,enabled;double now;float x,y,mix;
    while(scanf(" %c",&command)==1) {
        switch(command) {
        case 'P':
            if(scanf("%d %lf %f %f %f",&state,&now,&x,&y,&mix)!=5 || state<0 || state>=FACE_STATE_COUNT) return 2;
            face_render_eyes(&FACE_PROFILES[state],now,(face_gaze_t){x,y,mix},eyes);print_eyes(eyes);break;
        case 'I':
            if(scanf("%d %lf",&state,&now)!=2 || state<0 || state>=FACE_STATE_COUNT) return 2;
            face_motion_init(&motion,state,now);break;
        case 'S':
            if(scanf("%d %lf",&state,&now)!=2 || state<0 || state>=FACE_STATE_COUNT) return 2;
            face_motion_state(&motion,state,now);break;
        case 'L':
            if(scanf("%d %f %f %lf",&enabled,&x,&y,&now)!=4) return 2;
            face_motion_look(&motion,enabled,x,y,now);break;
        case 'R':
            if(scanf("%lf",&now)!=1) return 2;
            face_motion_sample(&motion,now,eyes);print_eyes(eyes);break;
        default:return 2;
        }
    }
    return 0;
}
