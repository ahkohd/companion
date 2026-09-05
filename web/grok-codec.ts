// RGB565 delta stream decoder. Format and reference implementation live in
// scripts/grok-codec.mjs; this is an intentional verbatim copy so the browser build
// does not import untyped Node scripts. test/grok-codec.test.mjs checks parity.
const OP_SKIP=0,OP_REPEAT=1,OP_LITERAL=2

// Applies `data` to `pixels` in place. Returns false on any malformed input without
// touching memory outside `pixels`; the buffer may then be partially updated.
export function decodeFrame(data:Uint8Array,pixels:Uint16Array):boolean {
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength)
  const length=data.byteLength,count=pixels.length
  let offset=0,pos=0
  while(offset<length) {
    if(length-offset<2) return false
    const control=view.getUint16(offset,true);offset+=2
    const len=(control&0x3FFF)+1,op=control>>14
    if(len>count-pos) return false
    if(op===OP_SKIP) {pos+=len;continue}
    if(length-offset<2) return false
    if(op===OP_REPEAT) {
      const color=view.getUint16(offset,true);offset+=2
      pixels.fill(color,pos,pos+len);pos+=len
    } else if(op===OP_LITERAL) {
      if(length-offset<2*len) return false
      for(let k=0;k<len;k++) pixels[pos+k]=view.getUint16(offset+2*k,true)
      offset+=2*len;pos+=len
    } else {
      const distance=view.getUint16(offset,true);offset+=2
      if(distance===0 || distance>pos) return false
      for(let k=0;k<len;k++) pixels[pos+k]=pixels[pos+k-distance]
      pos+=len
    }
  }
  return pos===count
}
