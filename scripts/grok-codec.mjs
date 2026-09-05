// Lossless delta codec for RGB565 frames.
//
// Stream: a sequence of commands. Each command starts with a little-endian
// uint16 control word: high 2 bits opcode, low 14 bits length-1 (1..16384).
//   0 SKIP    keep `length` pixels of the previous frame
//   1 REPEAT  next uint16 color, written `length` times
//   2 LITERAL next `length` uint16 pixels
//   3 COPY    next uint16 back distance d (1..pos); copy `length` pixels from
//             pos-d, byte-for-byte forward so overlap acts as a pattern fill
// A valid stream writes or skips exactly `count` pixels and has no trailing bytes.
//
// decodeFrame is duplicated verbatim in web/grok-codec.ts (browser build) and
// mirrored by firmware/main/grok_codec.c. Keep the three in sync.

export const MAX_LENGTH=16384;
export const OP_SKIP=0,OP_REPEAT=1,OP_LITERAL=2,OP_COPY=3;

const HASH_BITS=16,MIN_MATCH=4;
const table=new Int32Array(1<<HASH_BITS);
let scratch=new Uint8Array(0);

function hash4(f,i) {
  let h=Math.imul(f[i],0x9E3779B1);
  h=Math.imul(h^f[i+1],0x85EBCA77);
  h=Math.imul(h^f[i+2],0xC2B2AE3D);
  h=Math.imul(h^f[i+3],0x27D4EB2F);
  return (h^(h>>>15))>>>(32-HASH_BITS);
}
function matchLength(f,a,b,max) {let n=0;while(n<max && f[a+n]===f[b+n]) n++;return n}

// Encodes `frame` relative to `previous` (null = all black). `width` only tunes the
// row-above copy candidate; any value works. Returns an exact-size Uint8Array.
export function encodeFrame(frame,previous=null,width=256) {
  const count=frame.length;
  if(previous && previous.length!==count) throw new Error('previous frame size mismatch');
  const worst=2*count+2*Math.ceil(count/MAX_LENGTH)+2;
  if(scratch.length<worst) scratch=new Uint8Array(worst);
  const out=scratch;let o=0,pos=0,litStart=0,litLen=0;
  table.fill(-1);
  const control=(op,len)=>{const c=(op<<14)|(len-1);out[o++]=c&255;out[o++]=c>>8};
  const pixel=v=>{out[o++]=v&255;out[o++]=v>>8};
  const flush=()=>{
    while(litLen>0) {
      const n=Math.min(litLen,MAX_LENGTH);control(OP_LITERAL,n);
      for(let k=0;k<n;k++) pixel(frame[litStart+k]);
      litStart+=n;litLen-=n;
    }
  };
  while(pos<count) {
    const max=Math.min(MAX_LENGTH,count-pos);
    let skip=0;
    if(previous) {while(skip<max && frame[pos+skip]===previous[pos+skip]) skip++}
    else {while(skip<max && frame[pos+skip]===0) skip++}
    let repeat=1;const color=frame[pos];
    while(repeat<max && frame[pos+repeat]===color) repeat++;
    let copy=0,distance=0;
    if(pos+MIN_MATCH<=count) {
      const h=hash4(frame,pos),candidate=table[h];
      if(candidate>=0) {copy=matchLength(frame,candidate,pos,max);distance=pos-candidate}
      if(pos>=width) {
        const n=matchLength(frame,pos-width,pos,max);
        if(n>copy) {copy=n;distance=width}
      }
      if(copy<MIN_MATCH || distance>65535) copy=0;
    }
    // Savings in bytes against literal coding (2 bytes per pixel).
    const skipSave=skip? 2*skip-2:-1,repeatSave=2*repeat-4,copySave=copy? 2*copy-4:-1;
    const floor=litLen? 1:0;
    let op=-1,len=0,best=floor-1;
    if(skipSave>best) {best=skipSave;op=OP_SKIP;len=skip}
    if(repeatSave>best) {best=repeatSave;op=OP_REPEAT;len=repeat}
    if(copySave>best) {best=copySave;op=OP_COPY;len=copy}
    if(op<0) {if(!litLen) litStart=pos;litLen++;len=1}
    else {
      flush();control(op,len);
      if(op===OP_REPEAT) pixel(color);
      else if(op===OP_COPY) pixel(distance);
    }
    const end=Math.min(pos+len,count-MIN_MATCH+1);
    for(let k=pos;k<end;k++) table[hash4(frame,k)]=k;
    pos+=len;
  }
  flush();
  return out.slice(0,o);
}

// Applies `data` to `pixels` in place. Returns false on any malformed input without
// touching memory outside `pixels`; the buffer may then be partially updated.
export function decodeFrame(data,pixels) {
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const length=data.byteLength,count=pixels.length;
  let offset=0,pos=0;
  while(offset<length) {
    if(length-offset<2) return false;
    const control=view.getUint16(offset,true);offset+=2;
    const len=(control&0x3FFF)+1,op=control>>14;
    if(len>count-pos) return false;
    if(op===OP_SKIP) {pos+=len;continue}
    if(length-offset<2) return false;
    if(op===OP_REPEAT) {
      const color=view.getUint16(offset,true);offset+=2;
      pixels.fill(color,pos,pos+len);pos+=len;
    } else if(op===OP_LITERAL) {
      if(length-offset<2*len) return false;
      for(let k=0;k<len;k++) pixels[pos+k]=view.getUint16(offset+2*k,true);
      offset+=2*len;pos+=len;
    } else {
      const distance=view.getUint16(offset,true);offset+=2;
      if(distance===0 || distance>pos) return false;
      for(let k=0;k<len;k++) pixels[pos+k]=pixels[pos+k-distance];
      pos+=len;
    }
  }
  return pos===count;
}
