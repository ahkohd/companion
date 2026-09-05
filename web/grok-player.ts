import { decodeFrame } from './grok-codec'
export const GROK_WIDTH=192,GROK_HEIGHT=168
export class GrokPlayer {
  readonly pixels=new Uint16Array(GROK_WIDTH*GROK_HEIGHT)
  readonly data:Uint8Array
  readonly view:DataView
  readonly count:number;readonly loop:number;readonly fps:number;readonly key:number
  index=-1
  constructor(buffer:ArrayBuffer) {
    this.data=new Uint8Array(buffer);this.view=new DataView(buffer)
    const v=this.view
    if(buffer.byteLength<24 || v.getUint32(0,true)!==0x31435247 || v.getUint16(4,true)!==GROK_WIDTH || v.getUint16(6,true)!==GROK_HEIGHT) throw Error('Invalid animation clip')
    this.fps=v.getUint16(8,true);this.key=v.getUint16(10,true);this.count=v.getUint32(12,true);this.loop=v.getUint32(16,true)
    if(this.fps<1||this.fps>60||this.key<1||this.key>60||this.count<1||this.count>3600||v.getUint32(20,true)!==this.count||this.loop!==0xffffffff&&this.loop>=this.count||buffer.byteLength<24+(this.count+2)*4) throw Error('Invalid animation timing')
    let previous=24+(this.count+2)*4
    for(let i=0;i<=this.count+1;i++) {const offset=v.getUint32(24+i*4,true);if(offset<previous||offset>buffer.byteLength)throw Error('Invalid animation offsets');previous=offset}
    if(previous!==buffer.byteLength)throw Error('Invalid animation size')
  }
  frameIndex(age:number,still=false) {
    if(still)return this.count
    const tick=Math.floor(Math.max(0,Number.isFinite(age)?age:0)*this.fps)
    return tick<this.count?tick:this.loop===0xffffffff?this.count-1:this.loop+(tick-this.count)%(this.count-this.loop)
  }
  sample(age:number,still=false) {
    const target=this.frameIndex(age,still)
    if(target===this.index)return false
    const key=target===this.count?target:Math.floor(target/this.key)*this.key
    if(this.index<key||this.index>target||this.index===this.count) {this.pixels.fill(0);this.index=key-1}
    while(this.index<target) {
      const i=this.index+1,start=this.view.getUint32(24+i*4,true),end=this.view.getUint32(28+i*4,true)
      if(!decodeFrame(this.data.subarray(start,end),this.pixels)) {this.index=-1;throw Error('Could not decode animation')}
      this.index=i
    }
    return true
  }
}

const CHANNELS=[[11,31],[5,63],[0,31]] as const
// Identical integer bilinear sampling in firmware/main/grok_player.c.
let cachedWidth=0,cachedHeight=0,cachedScale=0
const left=new Int32Array(512),right=new Int32Array(512),xIndex=new Int32Array(512),xFraction=new Int32Array(512)
export function grokRaster(source:Uint16Array,pixels:Uint16Array,width:number,height:number,x=0,y=0,faceScale=100) {
  if(width<1||width>512||height<1||height>512||!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>2||Math.abs(y)>2||!Number.isInteger(faceScale)||faceScale<50||faceScale>150)return
  pixels.fill(0)
  const scale=width*.9/256*(faceScale/100),unit=200/GROK_WIDTH,step=Math.floor(65536/(scale*unit)+.5)
  let sx=Math.floor(((((.5-width/2-x*5*scale)/scale+100)/unit)-.5)*65536+.5)
  let sy=Math.floor(((((.5-width*.45-y*5*scale)/scale+100)/unit)-.5)*65536+.5)
  if(cachedWidth!==width||cachedHeight!==height||cachedScale!==faceScale) {
    for(let dy=0;dy<height;dy++) {
      const ry=(dy+.5-width*.45)/scale
      left[dy]=right[dy]=0
      if(ry>70||Math.abs(ry)>=100)continue
      const extent=Math.sqrt(10000-ry*ry)*scale
      left[dy]=Math.max(0,Math.ceil(width/2-extent-.5));right[dy]=Math.min(width,Math.floor(width/2+extent-.5)+1)
      if(faceScale!==100){const screenY=dy+.5-height/2,radius=Math.min(width,height)/2;const edge=Math.sqrt(Math.max(0,radius*radius-screenY*screenY));left[dy]=Math.max(left[dy]!,Math.ceil(width/2-edge-.5));right[dy]=Math.min(right[dy]!,Math.floor(width/2+edge-.5)+1)}
    }
    cachedWidth=width;cachedHeight=height;cachedScale=faceScale
  }
  for(let dx=0;dx<width;dx++,sx+=step){xIndex[dx]=sx>>16;xFraction[dx]=(sx>>8)&255}
  for(let dy=0;dy<height;dy++,sy+=step) {
    const iy=Math.floor(sy/65536),fy=Math.floor(sy/256)&255
    if(iy<0||iy>=GROK_HEIGHT-1)continue
    for(let dx=left[dy]!;dx<right[dy]!;dx++) {
      const ix=xIndex[dx]!,fx=xFraction[dx]!
      if(ix<0||ix>=GROK_WIDTH-1)continue
      const a=source[iy*GROK_WIDTH+ix]!,b=source[iy*GROK_WIDTH+ix+1]!,c=source[(iy+1)*GROK_WIDTH+ix]!,d=source[(iy+1)*GROK_WIDTH+ix+1]!
      if(a===b&&a===c&&a===d){pixels[dy*width+dx]=a;continue}
      let out=0
      for(const [shift,mask] of CHANNELS) {
        const top=(((a>>shift)&mask)*(256-fx)+((b>>shift)&mask)*fx),bottom=(((c>>shift)&mask)*(256-fx)+((d>>shift)&mask)*fx)
        out|=((top*(256-fy)+bottom*fy+32768)>>16)<<shift
      }
      pixels[dy*width+dx]=out
    }
  }
}
