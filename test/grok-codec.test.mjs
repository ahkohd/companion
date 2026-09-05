import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from 'vite';
import {encodeFrame,decodeFrame,MAX_LENGTH,OP_SKIP,OP_REPEAT,OP_LITERAL,OP_COPY} from '../scripts/grok-codec.mjs';

const WIDTH=256,HEIGHT=224,COUNT=WIDTH*HEIGHT;
let web,probe,directory;
before(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),'grok-codec-'));probe=path.join(directory,'probe');
  const sanitize=process.env.GROK_CODEC_SANITIZE? ['-O1','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer']:['-O2'];
  execFileSync(process.env.GROK_CODEC_SANITIZE? 'clang':'cc',['-std=c11',...sanitize,'-Wall','-Wextra','-Werror','-I','firmware/main','test/grok-codec-probe.c','firmware/main/grok_codec.c','-o',probe]);
  const result=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:'web/grok-codec.ts',formats:['es']}}});
  const bundle=Array.isArray(result)?result[0]:result;
  web=await import('data:text/javascript;base64,'+Buffer.from(bundle.output.find(c=>c.type==='chunk'&&c.isEntry).code).toString('base64'));
});
after(async()=>{if(directory) await rm(directory,{recursive:true,force:true})});

// Runs the C decoder on every {data,initial} record in one process. Returns [{ok,pixels}].
function decodeC(records) {
  const parts=[];
  for(const {data,initial} of records) {
    const header=Buffer.alloc(8);header.writeUInt32LE(initial.length,0);header.writeUInt32LE(data.byteLength,4);
    parts.push(header,Buffer.from(initial.buffer,initial.byteOffset,initial.byteLength),Buffer.from(data.buffer,data.byteOffset,data.byteLength));
  }
  const out=execFileSync(probe,[],{input:Buffer.concat(parts),maxBuffer:64*1024*1024});
  let o=0;
  return records.map(({initial})=>{
    const ok=out[o]===1;o++;
    const pixels=new Uint16Array(initial.length);
    for(let k=0;k<pixels.length;k++) pixels[k]=out.readUInt16LE(o+2*k);
    o+=2*initial.length;return {ok,pixels};
  });
}
// Decodes with the Node, browser and C decoders; asserts they agree and returns {ok,pixels}.
function decodeAll(data,initial) {
  const node=Uint16Array.from(initial),browser=Uint16Array.from(initial);
  const okNode=decodeFrame(data,node),okWeb=web.decodeFrame(data,browser);
  const [c]=decodeC([{data,initial}]);
  assert.equal(okWeb,okNode,'browser decoder disagrees with Node');
  assert.equal(c.ok,okNode,'C decoder disagrees with Node');
  assert.deepEqual(browser,node,'browser pixels differ');
  assert.deepEqual(c.pixels,node,'C pixels differ');
  return {ok:okNode,pixels:node};
}
function roundTrip(frame,previous) {
  const data=encodeFrame(frame,previous,WIDTH);
  const {ok,pixels}=decodeAll(data,previous??new Uint16Array(frame.length));
  assert.ok(ok,'decode failed');assert.deepEqual(pixels,frame);
  return data;
}
// Builds a stream from [op,len,...payload words].
function stream(commands) {
  const words=[];
  for(const [op,len,...rest] of commands) words.push((op<<14)|(len-1),...rest);
  const out=new Uint8Array(2*words.length);
  words.forEach((w,i)=>{out[2*i]=w&255;out[2*i+1]=w>>8});
  return out;
}
function ops(data) {
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength),seen=new Set();let o=0;
  while(o<view.byteLength) {
    const control=view.getUint16(o,true),op=control>>14,len=(control&0x3FFF)+1;o+=2;seen.add(op);
    if(op===OP_REPEAT||op===OP_COPY) o+=2;else if(op===OP_LITERAL) o+=2*len;
  }
  assert.equal(o,view.byteLength);return seen;
}

// Deterministic PRNG so failures reproduce.
function rng(seed) {let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
const rgb565=(r,g,b)=>((r&248)<<8)|((g&252)<<3)|(b>>3);
function blend(dst,color,alpha) {
  const r0=(dst>>11)*255/31,g0=((dst>>5)&63)*255/63,b0=(dst&31)*255/31;
  const r1=(color>>11)*255/31,g1=((color>>5)&63)*255/63,b1=(color&31)*255/31;
  return rgb565(Math.round(r0+(r1-r0)*alpha),Math.round(g0+(g1-g0)*alpha),Math.round(b0+(b1-b0)*alpha));
}
function circle(frame,cx,cy,radius,color) {
  for(let y=Math.max(0,Math.floor(cy-radius-1));y<Math.min(HEIGHT,cy+radius+2);y++) for(let x=Math.max(0,Math.floor(cx-radius-1));x<Math.min(WIDTH,cx+radius+2);x++) {
    const d=Math.hypot(x+.5-cx,y+.5-cy),alpha=Math.min(1,Math.max(0,radius-d+.5));
    if(alpha>0) frame[y*WIDTH+x]=blend(frame[y*WIDTH+x],color,alpha);
  }
}
function rect(frame,x0,y0,w,h,color) {for(let y=y0;y<y0+h;y++) frame.fill(color,y*WIDTH+x0,y*WIDTH+x0+w)}
function scene(t) {
  const frame=new Uint16Array(COUNT);
  for(let y=0;y<HEIGHT;y++) frame.fill(rgb565(0,0,y>>1),y*WIDTH,(y+1)*WIDTH);
  rect(frame,20,30,80,50,rgb565(200,40,40));rect(frame,150+t,120,60,60,rgb565(40,200,40));
  circle(frame,128+t*3.5,100+t*1.5,40,rgb565(255,255,255));circle(frame,60,170,25.3,rgb565(255,200,0));
  return frame;
}
const noise=(seed,count=COUNT)=>{const r=rng(seed),f=new Uint16Array(count);for(let i=0;i<count;i++) f[i]=Math.floor(r()*65536);return f};

test('keyframes: black, solid, gradients and a drawn scene round trip through all decoders',()=>{
  const black=new Uint16Array(COUNT);
  assert.equal(roundTrip(black,null).length,2*Math.ceil(COUNT/MAX_LENGTH),'black keyframe is pure skips');
  const solid=new Uint16Array(COUNT).fill(rgb565(30,144,255));
  assert.equal(roundTrip(solid,null).length,4*Math.ceil(COUNT/MAX_LENGTH),'solid keyframe is pure repeats');
  const horizontal=new Uint16Array(COUNT);
  for(let y=0;y<HEIGHT;y++) for(let x=0;x<WIDTH;x++) horizontal[y*WIDTH+x]=rgb565(x,255-x,128);
  const h=roundTrip(horizontal,null);assert.ok(h.length<600,`horizontal gradient ${h.length} bytes`);assert.ok(ops(h).has(OP_COPY));
  const vertical=new Uint16Array(COUNT);
  for(let y=0;y<HEIGHT;y++) vertical.fill(rgb565(y,y,y),y*WIDTH,(y+1)*WIDTH);
  const v=roundTrip(vertical,null);assert.ok(v.length<=4*HEIGHT,`vertical gradient ${v.length} bytes`);
  const s=roundTrip(scene(0),null);assert.ok(s.length<COUNT/4,`scene keyframe ${s.length} bytes`);
});
test('deltas: moving scene, sparse random changes, and unchanged frames use every opcode and stay small',()=>{
  let previous=scene(0);const sizes=[];
  for(let t=1;t<=4;t++) {
    const frame=scene(t),data=roundTrip(frame,previous);sizes.push(data.length);
    const seen=ops(data);for(const op of [OP_SKIP,OP_REPEAT,OP_LITERAL,OP_COPY]) assert.ok(seen.has(op),`frame ${t} lacks opcode ${op}`);
    previous=frame;
  }
  assert.ok(Math.max(...sizes)<6000,`scene deltas ${sizes}`);
  const same=roundTrip(previous,previous);assert.equal(same.length,2*Math.ceil(COUNT/MAX_LENGTH));
  const random=rng(7),sparse=Uint16Array.from(previous);
  for(let i=0;i<500;i++) sparse[Math.floor(random()*COUNT)]=Math.floor(random()*65536);
  const d=roundTrip(sparse,previous);assert.ok(d.length<=500*6+16,`sparse delta ${d.length} bytes`);
  const first=scene(2),second=roundTrip(first,noise(3));assert.ok(second.length<COUNT/4,`scene over noise ${second.length} bytes`);
});
test('incompressible noise never exceeds raw size plus command overhead',()=>{
  const frame=noise(11),data=roundTrip(frame,null);
  assert.ok(data.length<=2*COUNT+2*Math.ceil(COUNT/MAX_LENGTH),`noise ${data.length} bytes`);
  const small=noise(12,37);assert.ok(roundTrip(small,noise(13,37)).length<=2*37+2);
});
test('encoder never skips a changed pixel and honours the 16384 command limit',()=>{
  const previous=noise(21),frame=Uint16Array.from(previous);
  for(let i=0;i<COUNT;i+=97) frame[i]^=1;
  const data=encodeFrame(frame,previous),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  let o=0,pos=0;
  while(o<data.length) {
    const control=view.getUint16(o,true),op=control>>14,len=(control&0x3FFF)+1;o+=2;
    assert.ok(len<=MAX_LENGTH);
    if(op===OP_SKIP) for(let k=0;k<len;k++) assert.equal(frame[pos+k],previous[pos+k],`skip covers changed pixel ${pos+k}`);
    if(op===OP_REPEAT||op===OP_COPY) o+=2;else if(op===OP_LITERAL) o+=2*len;
    pos+=len;
  }
  assert.equal(pos,COUNT);
  const big=new Uint16Array(3*MAX_LENGTH+5).fill(9);
  assert.equal(roundTrip(big,null).length,16);
  assert.equal(roundTrip(new Uint16Array(MAX_LENGTH),null).length,2);
  assert.equal(roundTrip(new Uint16Array(0),null).length,0);
});
test('hand-built streams exercise skip, repeat, literal, overlapping copy and copies from skipped pixels',()=>{
  const previous=Uint16Array.from({length:32},(_,i)=>100+i);
  const data=stream([[OP_SKIP,4],[OP_REPEAT,3,7],[OP_LITERAL,3,1,2,3],[OP_COPY,9,3],[OP_COPY,4,19],[OP_COPY,3,1],[OP_SKIP,6]]);
  const {ok,pixels}=decodeAll(data,previous);
  assert.ok(ok);
  assert.deepEqual(Array.from(pixels),[100,101,102,103,7,7,7,1,2,3,1,2,3,1,2,3,1,2,3,100,101,102,103,103,103,103,126,127,128,129,130,131]);
  const offset=new Uint8Array(data.length+3);offset.set(data,3);
  assert.ok(decodeFrame(offset.subarray(3),Uint16Array.from(previous)),'decoder honours byteOffset');
  assert.ok(decodeAll(new Uint8Array(0),new Uint16Array(0)).ok,'empty stream for zero pixels');
  const max=decodeAll(stream([[OP_SKIP,MAX_LENGTH]]),new Uint16Array(MAX_LENGTH));assert.ok(max.ok);
  const literal=stream([[OP_LITERAL,MAX_LENGTH,...Array.from({length:MAX_LENGTH},(_,i)=>i&65535)]]);
  const full=decodeAll(literal,new Uint16Array(MAX_LENGTH));assert.ok(full.ok);assert.equal(full.pixels[MAX_LENGTH-1],MAX_LENGTH-1);
});
test('malformed streams fail in every decoder without touching memory outside the buffers',()=>{
  const eight=new Uint16Array(8).fill(5);
  const cases={
    'odd trailing byte':new Uint8Array([0,0,0]),
    'lone byte':new Uint8Array([1]),
    'repeat without color':stream([[OP_REPEAT,8]]),
    'literal short payload':stream([[OP_LITERAL,8,1,2,3]]),
    'copy without distance':stream([[OP_LITERAL,4,1,2,3,4],[OP_COPY,4]]),
    'skip overrun':stream([[OP_SKIP,9]]),
    'repeat overrun':stream([[OP_SKIP,4],[OP_REPEAT,5,1]]),
    'literal overrun':stream([[OP_LITERAL,9,1,2,3,4,5,6,7,8,9]]),
    'copy overrun':stream([[OP_LITERAL,4,1,2,3,4],[OP_COPY,5,4]]),
    'underrun':stream([[OP_SKIP,7]]),
    'empty for eight pixels':new Uint8Array(0),
    'zero distance':stream([[OP_LITERAL,4,1,2,3,4],[OP_COPY,4,0]]),
    'distance beyond written':stream([[OP_LITERAL,4,1,2,3,4],[OP_COPY,4,5]]),
    'copy before anything written':stream([[OP_COPY,4,1],[OP_SKIP,4]]),
    'trailing byte after complete frame':new Uint8Array([...stream([[OP_SKIP,8]]),0]),
    'trailing command after complete frame':stream([[OP_SKIP,8],[OP_SKIP,1]]),
    'trailing zero-length literal after complete frame':stream([[OP_SKIP,8],[OP_LITERAL,1,0]]),
    'command for zero pixels':stream([[OP_SKIP,1]]),
    'max length over count':stream([[OP_SKIP,MAX_LENGTH]]),
  };
  const initialFor=name=>name==='command for zero pixels'? new Uint16Array(0):eight;
  const names=Object.keys(cases),c=decodeC(names.map(name=>({data:cases[name],initial:initialFor(name)})));
  names.forEach((name,i)=>{
    const data=cases[name],node=Uint16Array.from(initialFor(name)),browser=Uint16Array.from(initialFor(name));
    assert.equal(decodeFrame(data,node),false,`${name}: node accepted`);
    assert.equal(web.decodeFrame(data,browser),false,`${name}: browser accepted`);
    assert.equal(c[i].ok,false,`${name}: C accepted`);
    assert.deepEqual(browser,node,`${name}: browser partial output differs`);
    assert.deepEqual(c[i].pixels,node,`${name}: C partial output differs`);
  });
  const good=stream([[OP_LITERAL,4,1,2,3,4],[OP_COPY,4,4]]);
  assert.deepEqual(Array.from(decodeAll(good,eight).pixels),[1,2,3,4,1,2,3,4],'distance equal to written count is allowed');
});
