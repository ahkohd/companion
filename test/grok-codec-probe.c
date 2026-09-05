// Reads records from stdin until EOF: u32 count, u32 length, u16 initial[count],
// u8 data[length]. Writes per record: u8 ok, u16 pixels[count]. Buffers are
// exact-size heap allocations so sanitizers catch any out-of-bounds access.
#include "grok_codec.h"
#include <stdio.h>
#include <stdlib.h>

static int read_u32(uint32_t *v) {
    uint8_t b[4];if(fread(b,1,4,stdin)!=4) return 0;
    *v=b[0]|(b[1]<<8)|(b[2]<<16)|((uint32_t)b[3]<<24);return 1;
}
int main(void) {
    uint32_t count,length;
    while(read_u32(&count)) {
        if(!read_u32(&length) || count>(1u<<24) || length>(1u<<26)) return 2;
        uint16_t *pixels=malloc(count? count*sizeof(uint16_t):1);
        uint8_t *data=malloc(length? length:1);
        if(!pixels || !data) return 3;
        if(fread(pixels,sizeof(uint16_t),count,stdin)!=count) return 2;
        if(fread(data,1,length,stdin)!=length) return 2;
        uint8_t ok=grok_decode(data,length,pixels,count);
        fwrite(&ok,1,1,stdout);fwrite(pixels,sizeof(uint16_t),count,stdout);
        free(pixels);free(data);
    }
    return 0;
}
