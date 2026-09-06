/** Delay choices until a second tap has been ruled out. */
export class AttentionTapGate {
 private timer: ReturnType<typeof setTimeout> | null = null
 private point: {x:number;y:number} | null = null
 private at = 0
 private held = false
 constructor(private dismiss:()=>void) {}
 press(point:{x:number;y:number}) {
  if(this.timer!==null && this.point && performance.now()-this.at<=300 && Math.hypot(point.x-this.point.x,point.y-this.point.y)<=40) {
   clearTimeout(this.timer);this.timer=null;this.held=true
  }
 }
 tap(point:{x:number;y:number},single:()=>void) {
  const now=performance.now()
  if(this.timer!==null || this.held) {
   if(this.point && (this.held || now-this.at<=300) && Math.hypot(point.x-this.point.x,point.y-this.point.y)<=40) {
    this.cancel();this.dismiss()
   } else if(this.held) this.cancel()
   return
  }
  this.point=point;this.at=now
  this.timer=setTimeout(()=>{this.timer=null;this.point=null;single()},300)
 }
 cancel(){if(this.timer!==null)clearTimeout(this.timer);this.timer=null;this.point=null;this.held=false}
}
