#include "face_accent.h"
#include <stdio.h>
#include <stdlib.h>
int main(int argc,char **argv) {
    int state;double age;
    face_accent_t accent;
    if(argc==3 || argc==4) {
        state=atoi(argv[1]);age=atof(argv[2]);
        face_motion_t m;face_motion_init(&m,state,0);face_eye_t eyes[2];
        face_motion_sample(&m,age,eyes);face_accent_sample(state,age,&accent);face_accent_eyes(&accent,eyes);
        uint16_t *pixels=calloc(466*466,sizeof(uint16_t));if(!pixels) return 3;
        if(argc==3) face_rasterize(pixels,466,466,eyes,face_motion_color(&m));
        face_draw_decor(pixels,466,466,accent.decor,accent.count);
        printf("P6\n466 466\n255\n");
        for(int i=0;i<466*466;i++) {
            unsigned char rgb[3]={(pixels[i]>>11)*255/31,((pixels[i]>>5)&63)*255/63,(pixels[i]&31)*255/31};fwrite(rgb,1,3,stdout);
        }
        free(pixels);return 0;
    }
    while(scanf("%d %lf",&state,&age)==2) {
        face_accent_sample(state,age,&accent);
        printf("{\"x\":%.6f,\"y\":%.6f,\"rotation\":%.6f,\"scale\":%.6f,\"decor\":[",accent.x,accent.y,accent.rotation,accent.scale);
        for(int i=0;i<accent.count;i++) {
            const face_polygon_t *p=&accent.decor[i];
            printf("%s{\"color\":%u,\"alpha\":%.6f,\"points\":[",i?",":"",p->color,p->alpha);
            for(int j=0;j<p->count;j++) printf("%s[%.3f,%.3f]",j?",":"",p->points[j][0],p->points[j][1]);
            printf("]}");
        }
        face_eye_t eyes[2]={ {.matrix={1,.2,-.1,.8,-20,10}}, {.matrix={.6,-.1,.2,.9,30,5}} };
        face_accent_eyes(&accent,eyes);
        printf("],\"matrices\":[");
        for(int i=0;i<2;i++) {
            printf("%s[",i?",":"");for(int j=0;j<6;j++) printf("%s%.6f",j?",":"",eyes[i].matrix[j]);printf("]");
        }
        puts("]}");
    }
    return 0;
}
