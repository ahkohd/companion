import { AttentionTapGate } from '../lib/attention-tap'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Bell, Check, CircleAlert, Clock, ListOrdered, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import { animations, animationName, type StudioSnapshot } from '../lib/studio'
import './attention.css'

export interface AttentionAction {id:string;label:string;kind:string}
export interface AttentionRequest {id:string;owner:string;kind:'notification'|'decision';title:string;description:string;body:string;animation:string|null;actions:AttentionAction[];revision:number;detail:boolean;stepIndex?:number;stepCount?:number;remainingMs?:number|null;outcome?:string;status?:string}
export interface AttentionState {enabled:boolean;active:AttentionRequest|null;queue:AttentionRequest[];history:{id:string;owner:string;title:string;kind:string;outcome:string;action:string|null;revision:number;completedAt:number}[]}
type Action=(path:string,payload:unknown,message?:string)=>Promise<boolean>
const limited=(value:string,max:number)=>Array.from(value).slice(0,max).join('')
const count=(value:string)=>Array.from(value).length

function useWidthWarning(title:string,description:string,s:StudioSnapshot) {
 const [warning,setWarning]=useState('')
 const d=s.settings.design.face
 useEffect(()=>{let mounted=true
 const measure=()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)return
 const titles:[string,number,number,string][]=[[title,d.titleSize,d.titleWidth,'Title'],[description,d.nameSize,d.nameWidth,'Description']]
 const wide=titles.filter(([text,size,width])=>{ctx.font=`${size}px Geist, sans-serif`;return ctx.measureText(text).width+Math.max(0,text.length-1)>width}).map(item=>item[3])
 if(mounted)setWarning(wide.length?`${wide.join(' and ')} may be clipped at your current device font size. Shorten the text or adjust it in Designer.`:'')}
 measure();void document.fonts.ready.then(measure);return()=>{mounted=false}
 },[title,description,d.titleSize,d.titleWidth,d.nameSize,d.nameWidth])
 return warning
}
function RequestCard({request,active=false,pending,action}:{request:AttentionRequest;active?:boolean;pending:boolean;action:Action}) {
 return <article className="attention-request"><div className="attention-request-icon">{request.kind==='decision'?<CircleAlert size={18}/>:<Bell size={18}/>}</div><div className="attention-request-copy"><div><h3>{request.title}</h3><Badge variant={active?'secondary':'outline'}>{active?'On device':request.kind==='decision'?'Decision':'Notification'}</Badge></div>{request.description&&<p>{request.description}</p>}<small>{request.owner} · {animationName(request.animation)}{request.stepCount&&request.stepCount>1?` · Step ${(request.stepIndex??0)+1} of ${request.stepCount}`:''}</small></div><div className="attention-request-actions">{active&&<Button size="sm" variant="outline" disabled={pending} onClick={()=>void action('attention/details',{id:request.id,revision:request.revision,detail:!request.detail})}>{request.detail?'Show face':'View details'}</Button>}<Button variant="ghost" size="icon-sm" aria-label={`Clear ${request.title}`} disabled={pending} onClick={()=>void action('attention/clear',{id:request.id,owner:request.owner},'Request cleared')}><Trash2 size={15}/></Button></div></article>
}
export default function Attention({snapshot:s,pending,action}:{snapshot:StudioSnapshot;pending:boolean;action:Action}) {
 const state=s.attention
 const [kind,setKind]=useState<'notification'|'decision'>('notification')
 const [title,setTitle]=useState('A little update')
 const [description,setDescription]=useState('Tap to read')
 const [body,setBody]=useState('')
 const [animation,setAnimation]=useState('done')
 const [duration,setDuration]=useState(10)
 const [actionCount,setActionCount]=useState(2)
 const [primary,setPrimary]=useState('Approve'),[secondary,setSecondary]=useState('Decline')
 const id=useId(),warning=useWidthWarning(title,description,s)
 const disabled=pending||!state,enabled=state?.enabled===true
 const submit=async(event:FormEvent)=>{event.preventDefault();if(disabled||!enabled)return
 await action('attention/show',{owner:'studio',kind,title:title.trim(),description:description.trim(),body:body.trim(),animation,...(kind==='notification'?{durationMs:duration*1000}:{}),...(kind==='decision'?{actions:[{id:'primary',label:primary.trim(),kind:'respond'},...(actionCount===2?[{id:'secondary',label:secondary.trim(),kind:'dismiss'}]:[])]}:{})},state?.active?'Request queued':'Attention sent to your device')
 }
 return <div className="attention-page">
  <section className="panel"><div className="attention-enable"><div className="attention-heading-icon"><Bell size={20}/></div><div><h2>A moment of attention</h2><p>Let a message or decision briefly take the screen. Your previous module returns when it is finished.</p></div><Switch checked={enabled} disabled={disabled} aria-label="Enable device attention" onCheckedChange={value=>void action('attention/configure',{enabled:value},value?'Device attention enabled':'Device attention disabled')}/></div>{!enabled&&<div className="attention-off" role="status">Attention is off. Enable it to send requests to the device.</div>}</section>
  <section className="panel"><div className="panel-header"><div><h2>Compose a request</h2><p>Try it here before connecting your agents and tools.</p></div><Send size={17}/></div>
   <form onSubmit={submit} className="attention-composer">
    <div className="attention-kinds" role="group" aria-label="Request type">{(['notification','decision'] as const).map(value=><button type="button" key={value} aria-pressed={kind===value} onClick={()=>setKind(value)}><span>{value==='notification'?<Bell size={17}/>:<CircleAlert size={17}/>}<strong>{value==='notification'?'Notification':'Decision'}</strong>{kind===value&&<Check size={14}/>}</span><small>{value==='notification'?'A short update, then back to normal.':'Wait for a choice before continuing.'}</small></button>)}</div>
    <div className="attention-fields"><label htmlFor={`${id}-title`}>Title <small>{count(title)}/24</small></label><Input id={`${id}-title`} value={title} required onChange={e=>setTitle(limited(e.target.value,24))}/><label htmlFor={`${id}-description`}>Description <small>{count(description)}/48</small></label><Input id={`${id}-description`} value={description} onChange={e=>setDescription(limited(e.target.value,48))}/>{warning&&<p className="attention-warning" role="status"><CircleAlert size={14}/>{warning}</p>}<label htmlFor={`${id}-body`}>Details <small>{count(body)}/480 · optional</small></label><textarea id={`${id}-body`} rows={4} value={body} onChange={e=>setBody(limited(e.target.value,480))} placeholder="More context, shown when you tap the face."/><p className="attention-field-note">Keep the title and description short. Details can scroll on the device.</p></div>
    <div className="attention-options"><label htmlFor={`${id}-animation`}>Animation<select id={`${id}-animation`} value={animation} onChange={e=>setAnimation(e.target.value)}>{animations.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{kind==='notification'?<label htmlFor={`${id}-duration`}>Show for<select id={`${id}-duration`} value={duration} onChange={e=>setDuration(Number(e.target.value))}>{[5,10,20,30,60].map(value=><option value={value} key={value}>{value} seconds{value===10?' (default)':''}</option>)}</select></label>:<label htmlFor={`${id}-action-count`}>Choices<select id={`${id}-action-count`} value={actionCount} onChange={e=>setActionCount(Number(e.target.value))}><option value={1}>One button</option><option value={2}>Two buttons</option></select></label>}</div>
    {kind==='decision'&&<div className="attention-options"><label htmlFor={`${id}-primary`}>Primary button<Input id={`${id}-primary`} value={primary} required onChange={e=>setPrimary(limited(e.target.value,16))}/></label>{actionCount===2&&<label htmlFor={`${id}-secondary`}>Secondary button<Input id={`${id}-secondary`} value={secondary} required onChange={e=>setSecondary(limited(e.target.value,16))}/></label>}</div>}
    <div className="attention-submit"><span><Clock size={14}/>{kind==='decision'?'Stays until a choice is made':`Returns to your module after ${duration} seconds`}</span><Button type="submit" disabled={disabled||!enabled||!title.trim()||kind==='decision'&&(!primary.trim()||actionCount===2&&!secondary.trim())}><Send size={14}/>{state?.active?'Add to queue':'Send to device'}</Button></div>
   </form>
  </section>
  <section className="panel"><div className="panel-header"><div><h2>On the device</h2><p>{state?.active?'Tap the face in the preview to read and respond.':'Your companion is following its usual modules.'}</p></div><Badge variant="outline">{state?.queue.length??0} queued</Badge></div>{state?.active?<RequestCard request={state.active} active pending={disabled} action={action}/>:<div className="attention-empty"><Check size={18}/><span>No requests waiting for you.</span></div>}{!!state?.queue.length&&<div className="attention-queue"><h3><ListOrdered size={15}/>Up next</h3>{state.queue.map(request=><RequestCard key={request.id} request={request} pending={disabled} action={action}/>)}</div>}</section>
  {!!state?.history.length&&<section className="panel"><div className="panel-header"><div><h2>Recent requests</h2><p>Completed and cleared requests from this bridge session.</p></div></div><div className="attention-history">{state.history.slice(0,8).map(request=><div key={request.id}><span><strong>{request.title}</strong><small>{request.owner}</small></span><Badge variant="outline">{request.outcome||'Finished'}</Badge></div>)}</div></section>}
 </div>
}

export function AttentionOverlay({request,pending,detail=false}:{request:AttentionRequest;pending:boolean;detail?:boolean}) {
 const [busy,setBusy]=useState(false),lock=useRef(false)
 const bodyRef=useRef<HTMLDivElement>(null)
 const contact=useRef<{id:number;x:number;y:number;travel:number;at:number}|null>(null)
 const eligible=useRef(false)
 const send=async(path:string,payload:object)=>{if(lock.current||pending)return;lock.current=true;setBusy(true);try{const response=await fetch(`/api/attention/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:request.id,revision:request.revision,...payload})});const result=await response.json();if(!response.ok)throw Error(result.error||'Could not update this request.')}catch(error){toast.error(error instanceof Error?error.message:'Could not reach the bridge.')}finally{lock.current=false;setBusy(false)}}
 const gate=useRef<AttentionTapGate|null>(null)
 if(!gate.current)gate.current=new AttentionTapGate(()=>void send('dismiss',{}))
 useEffect(()=>{if(bodyRef.current)bodyRef.current.scrollTop=0;return()=>gate.current?.cancel()},[request.id,request.revision])
 useEffect(()=>{if(pending)gate.current?.cancel()},[pending])
 useEffect(()=>{const cancel=()=>{contact.current=null;eligible.current=false;gate.current?.cancel()};window.addEventListener('blur',cancel);const visibility=()=>{if(document.hidden)cancel()};document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);cancel()}},[])
 const point=(event:{clientX:number;clientY:number;currentTarget:Element})=>{const bounds=event.currentTarget.getBoundingClientRect();return{x:(event.clientX-bounds.left)*466/bounds.width,y:(event.clientY-bounds.top)*466/bounds.height}}
 const gestures={
  onPointerDown:(event:React.PointerEvent<Element>)=>{event.stopPropagation();eligible.current=false;if(!event.isPrimary||event.button!==0||pending||busy)return;const p=point(event);gate.current?.press(p);contact.current={id:event.pointerId,...p,travel:0,at:performance.now()}},
  onPointerMove:(event:React.PointerEvent<Element>)=>{const start=contact.current;if(start?.id===event.pointerId){const p=point(event);start.travel=Math.max(start.travel,Math.hypot(p.x-start.x,p.y-start.y));if(start.travel>12)gate.current?.cancel()}},
  onPointerUp:(event:React.PointerEvent<Element>)=>{event.stopPropagation();const start=contact.current;contact.current=null;if(start){const p=point(event);start.travel=Math.max(start.travel,Math.hypot(p.x-start.x,p.y-start.y))}eligible.current=!!start&&start.id===event.pointerId&&start.travel<=12&&performance.now()-start.at<=500;if(!eligible.current)gate.current?.cancel()},
  onPointerCancel:()=>{contact.current=null;eligible.current=false;gate.current?.cancel()},
  onPointerLeave:()=>{if(contact.current){contact.current=null;eligible.current=false;gate.current?.cancel()}},
  onScrollCapture:()=>{eligible.current=false;gate.current?.cancel()},
  onClick:(event:React.MouseEvent<Element>)=>{event.stopPropagation();if(pending||busy||event.detail!==0&&!eligible.current)return;eligible.current=false
   const action=(event.target as Element).closest('[data-attention-action]')?.getAttribute('data-attention-action')
   const p=event.detail===0?{x:233,y:233}:point(event)
   gate.current?.tap(p,()=>{if(action==='open')void send('details',{detail:true});else if(action)void send('act',{action})})
  },
  onDoubleClick:(event:React.MouseEvent<Element>)=>event.preventDefault(),
 }
 if(!detail)return <button className="attention-face-hit" disabled={pending||busy} data-attention-action="open" aria-label={`View details: ${request.title}. Double tap to dismiss.`} {...gestures}/>
 return <svg className="attention-detail-screen" viewBox="0 0 466 466" role="group" aria-label={`Attention details: ${request.title}. Double tap to dismiss.`} {...gestures}><foreignObject x={73} y={32} width={320} height={374}><div className="attention-detail" data-choices={request.actions.length}>
  <h3>{request.title}</h3><div className="attention-detail-body" ref={bodyRef} tabIndex={0} aria-label="Request details">{request.body||request.description||'No additional details.'}</div>
  <div className="attention-detail-buttons">{request.actions.map(item=><button key={item.id} data-attention-action={item.id} className={item.kind==='dismiss'?'secondary':''} disabled={pending||busy}>{item.label}</button>)}</div>
 </div></foreignObject></svg>
}
