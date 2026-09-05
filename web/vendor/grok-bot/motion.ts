// Adapted from BIGAGENT's Grok Bot 0.18 renderer. See NOTICE.md and LICENSE.
export type Polygon = {color:number; alpha:number; points:[number,number][]}
export type Accent = {x:number; y:number; rotation:number; scale:number; decor:Polygon[]}
const clamp=(x:number)=>Math.max(0,Math.min(1,x))
const round=(x:number)=>Math.round(x*100)/100
export const BOUNCES = [[48,.5],[28,.382],[14,.27],[6,.177]] as const
export const COLORS = [0xf9705c,0x5b95f0,0x3fbe86,0xf5b13f,0x9a72ee,0x35c3bd]
let seed=0x6b726f6b
function random() {
  let t=seed+=0x6d2b79f5
  t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61)
  return ((t^(t>>>14))>>>0)/4294967296
}
const between=(a:number,b:number)=>a+(b-a)*random()
export const PARTICLES=Array.from({length:20},(_,i)=>{
  const a=i/20*Math.PI*2+between(-.35,.35),r=between(96,116)*.4,speed=between(170,360)*.4
  const star=random()<.18
  return {x:Math.cos(a)*r,y:Math.sin(a)*r-12,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed-between(20,75)*.4,
    life:between(.45,.85),size:between(star?4:3.5,star?7:8)*.65,angle:between(0,360),spin:between(-260,260),
    color:star?0xf4c34e:COLORS[Math.floor(random()*COLORS.length)]!,shape:star?2:random()<.3?1:0}
})
export function polygon(x:number,y:number,r:number,angle:number,shape:number,color:number,alpha:number):Polygon {
  const count=shape===2?10:shape===1?12:4
  return {color,alpha,points:Array.from({length:count},(_,i)=>{
    const a=(angle-90)*Math.PI/180+i/count*Math.PI*2,k=shape===2&&i%2?.42:1
    return [round(x+Math.cos(a)*r*k),round(y+Math.sin(a)*r*k)]
  })}
}
const ease=(x:number)=>x<.5?4*x*x*x:1-((-2*x+2)**3)/2
export function grokAccent(state:string,age:number,still=false):Accent {
  const out:Accent={x:0,y:0,rotation:0,scale:1,decor:[]}
  if(still||!Number.isFinite(age)||age<0) return out
  if(state==='working') {
    const fade=1-(1-clamp(age/.45))**3
    // The upstream thinking pose, reduced to suit the small round display.
    out.rotation=(-9+Math.sin(age*.35)*5)*.6*fade
    out.x=Math.sin(age*.3)*3*fade;out.y=Math.sin(age*.6)*1.5*fade
  } else if(state==='done') {
    const t=age-.14
    if(t>=0&&t<.7) out.rotation=360*ease(t/.7)
    let bounce=t-.7
    for(const [height,duration] of BOUNCES) {
      if(bounce>=0&&bounce<duration) {const u=bounce/duration;out.y=-4*height*.38*u*(1-u);break}
      bounce-=duration
    }
    const life=age-.94,drag=-60*Math.log(.94),travel=(1-Math.exp(-drag*Math.max(0,life)))/drag
    for(const p of PARTICLES) {
      if(life<=0||life>=p.life) continue
      const u=life/p.life,alpha=u<.1?u/.1:(1-(u-.1)/.9)**1.7
      out.decor.push(polygon(p.x+p.vx*travel,p.y+p.vy*travel+16/drag*(life-travel),Math.max(p.size*(1-u*.4),.5),p.angle+p.spin*life,p.shape,p.color,alpha))
    }
  }
  return out
}
