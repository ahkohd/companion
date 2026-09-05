#include "grok_player.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static grok_player_t player;
static uint16_t source[GROK_PIXELS],screen[466*466];
static uint8_t *data;
static char current[256];
static int open_clip(const char *name) {
    if(strcmp(name,current)==0)return 1;
    FILE *f=fopen(name,"rb");if(!f)return 0;
    if(fseek(f,0,SEEK_END)!=0){fclose(f);return 0;}
    long size=ftell(f);if(size<0||size>8000000){fclose(f);return 0;}rewind(f);
    free(data);data=malloc((size_t)size);if(!data){fclose(f);return 0;}
    size_t got=fread(data,1,(size_t)size,f);fclose(f);
    if(got!=(size_t)size||!grok_player_open(&player,data,got,source))return 0;
    snprintf(current,sizeof(current),"%s",name);return 1;
}
int main(int argc,char **argv) {
    if(argc>=4&&strcmp(argv[1],"--ppm")==0) {
        if(!open_clip(argv[2])||!grok_player_sample(&player,strtod(argv[3],NULL),false))return 1;
        grok_blit_scaled(source,screen,466,466,argc>4?strtod(argv[4],NULL):0,argc>5?strtod(argv[5],NULL):0,argc>6?atoi(argv[6]):100);
        printf("P6\n466 466\n255\n");
        for(int i=0;i<466*466;i++){uint16_t p=screen[i];int r=p>>11,g=(p>>5)&63,b=p&31;putchar((r<<3)|(r>>2));putchar((g<<2)|(g>>4));putchar((b<<3)|(b>>2));}free(data);return 0;
    }
    char name[256];double age;int still;
    while(scanf("%255s %lf %d",name,&age,&still)==3) {
        if(!open_clip(name)||!grok_player_sample(&player,age,still!=0))return 1;
        printf("{\"index\":%d,\"hash\":%u}\n",player.index,player.hash);
    }
    free(data);return 0;
}
