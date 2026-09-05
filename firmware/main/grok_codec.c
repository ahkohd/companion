#include "grok_codec.h"

#define GROK_OP_SKIP 0
#define GROK_OP_REPEAT 1
#define GROK_OP_LITERAL 2

static inline uint16_t read_u16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

bool grok_decode(const uint8_t *data, size_t length, uint16_t *pixels, size_t count) {
    if((!data && length) || (!pixels && count)) return false;
    size_t offset=0,pos=0;
    while(offset<length) {
        if(length-offset<2) return false;
        uint16_t control=read_u16(data+offset);offset+=2;
        size_t len=(size_t)(control&0x3FFF)+1;unsigned op=control>>14;
        if(len>count-pos) return false;
        if(op==GROK_OP_SKIP) {pos+=len;continue;}
        if(length-offset<2) return false;
        uint16_t *dst=pixels+pos;
        if(op==GROK_OP_REPEAT) {
            uint16_t color=read_u16(data+offset);offset+=2;
            for(size_t k=0;k<len;k++) dst[k]=color;
        } else if(op==GROK_OP_LITERAL) {
            if(length-offset<2*len) return false;
            const uint8_t *src=data+offset;
            for(size_t k=0;k<len;k++) dst[k]=read_u16(src+2*k);
            offset+=2*len;
        } else {
            size_t distance=read_u16(data+offset);offset+=2;
            if(distance==0 || distance>pos) return false;
            const uint16_t *src=dst-distance;
            for(size_t k=0;k<len;k++) dst[k]=src[k];
        }
        pos+=len;
    }
    return pos==count;
}
