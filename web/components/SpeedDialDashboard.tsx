import { useRef } from 'react'
import { Check, LoaderCircle, X, Zap } from 'lucide-react'
import { speedDialLayout } from '../../shared/speed-dial-layout.mjs'
import { colorHex, type DesignValues } from '../lib/design'
import type { SpeedDialRunRequest, StudioSnapshot } from '../lib/studio'
import './speed-dial.css'

type Dashboard=NonNullable<StudioSnapshot['display']['dashboard']>

function DialHit({request,label,disabled,onRun,onSwipe,radius}:{request:SpeedDialRunRequest;label:string;disabled:boolean;onRun?:(request:SpeedDialRunRequest)=>void;onSwipe:(x:number,y:number)=>void;radius:number}) {
  const gesture=useRef<{id:number;x:number;y:number;at:number;travel:number;token:string|undefined}|null>(null)
  const run=()=>{if(!disabled)onRun?.(request)}
  return <button className="dp-dial-hit" style={{borderRadius:radius}} aria-label={`Run ${label}`} disabled={disabled}
    onPointerDown={event=>{event.stopPropagation();if(!event.isPrimary||event.button!==0)return;gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now(),travel:0,token:request.token};event.currentTarget.setPointerCapture(event.pointerId)}}
    onPointerMove={event=>{const start=gesture.current;if(start?.id===event.pointerId)start.travel=Math.max(start.travel,Math.abs(event.clientX-start.x),Math.abs(event.clientY-start.y))}}
    onPointerUp={event=>{event.stopPropagation();const start=gesture.current;gesture.current=null;if(!start||start.id!==event.pointerId)return;const elapsed=performance.now()-start.at;if(elapsed>1500)return;const x=event.clientX-start.x,y=event.clientY-start.y;onSwipe(x,y);if(elapsed<=500&&start.travel<12&&Math.abs(x)<12&&Math.abs(y)<12&&start.token===request.token)run()}}
    onPointerCancel={()=>{gesture.current=null}} onLostPointerCapture={()=>{gesture.current=null}}
    onClick={event=>{event.stopPropagation();if(event.detail===0)run()}}/>
}

export default function SpeedDialDashboard({dashboard,d,pending,onRun,onSwipe,screenShape='round'}:{dashboard:Dashboard;screenShape?:'round'|'rectangular';d:DesignValues;pending?:boolean;onRun?:(request:SpeedDialRunRequest)=>void;onSwipe:(x:number,y:number)=>void}) {
  const layout=speedDialLayout({screenShape:dashboard.screenShape??screenShape,layout:dashboard.layout??'grid',gridSize:dashboard.gridSize??0,listRows:dashboard.listRows??3,showLabels:dashboard.showLabels!==false,pageCount:dashboard.pageCount??1,buttonCount:dashboard.buttons?.length??0},d)
  const buttons=dashboard.buttons||[]
  return <>
    {!buttons.length&&<foreignObject x={63} y={196} width={340} height={76}><div className="dp-dial-empty" style={{color:colorHex(d.textColor)}}><strong>No buttons yet</strong><span style={{color:colorHex(d.mutedColor)}}>{dashboard.detail||'Add buttons in Modules'}</span></div></foreignObject>}
    {buttons.slice(0,layout.slots.length).map((button,index)=>{const slot=layout.slots[index],status=button.status,StatusIcon=status==='running'?LoaderCircle:status==='success'?Check:X;return <g key={`${button.id}:${dashboard.openToken||'sample'}`} opacity={button.enabled?1:.4}>
      <rect x={slot.x} y={slot.y} width={slot.width} height={slot.height} rx={slot.radius} fill={dashboard.layout==='list'?'none':button.color===null?'var(--device-surface)':colorHex(button.color)}/>
      {button.iconId?<image href={`/api/speed-dial/icons/${button.iconId}.png`} x={slot.icon.x} y={slot.icon.y} width={slot.icon.size} height={slot.icon.size} preserveAspectRatio="xMidYMid meet"/>:<foreignObject x={slot.icon.x} y={slot.icon.y} width={slot.icon.size} height={slot.icon.size}><Zap size={slot.icon.size} color="#8c8c8c" strokeWidth={1.65}/></foreignObject>}
      {slot.label&&<foreignObject x={slot.label.x} y={slot.label.y} width={slot.label.width} height={slot.label.height}><div className="dp-dial-label" style={{fontSize:d.labelSize,lineHeight:`${slot.label.height}px`,textAlign:slot.label.align,color:colorHex(d.textColor)}}>{button.label}</div></foreignObject>}
      {status!=='idle'&&<foreignObject x={slot.status.x} y={slot.status.y} width={slot.status.size} height={slot.status.size}><span className={`dp-dial-status dp-dial-status-${status}`}><StatusIcon size={slot.status.size} className={status==='running'?'sd-spin':undefined}/></span></foreignObject>}
      <foreignObject x={slot.x} y={slot.y} width={slot.width} height={slot.height}><DialHit request={{id:button.id,token:dashboard.openToken}} label={button.label} radius={slot.radius} disabled={!!pending||!onRun||!dashboard.openToken||!button.enabled||status==='running'} onRun={onRun} onSwipe={onSwipe}/></foreignObject>
    </g>})}
    {(dashboard.pageCount??1)>1&&<foreignObject {...layout.page}><div className="dp-dial-page" style={{color:colorHex(d.mutedColor)}}>{(dashboard.pageIndex??0)+1} / {dashboard.pageCount}</div></foreignObject>}
  </>
}
