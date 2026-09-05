#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define GROK_WIDTH 192
#define GROK_HEIGHT 168
#define GROK_PIXELS (GROK_WIDTH*GROK_HEIGHT)
typedef struct {
    const uint8_t *data;
    size_t length;
    uint16_t *pixels;
    uint32_t count, loop, hash;
    uint16_t fps, key;
    int index;
} grok_player_t;
bool grok_player_open(grok_player_t *p,const uint8_t *data,size_t length,uint16_t *pixels);
bool grok_player_sample(grok_player_t *p,double age,bool still);
void grok_blit(const uint16_t *source,uint16_t *pixels,int width,int height,double x,double y);

void grok_blit_scaled(const uint16_t *source,uint16_t *pixels,int width,int height,double x,double y,int face_scale);

void grok_blit_themed(const uint16_t *source, uint16_t *pixels, int width, int height, double x, double y, int face_scale, uint32_t background, uint32_t foreground);
