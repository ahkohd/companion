import { useEffect, useRef, useState } from 'react'
import { Activity, Check, CircleHelp, Clock, Download, Grid2X2, Mail, Music2, RotateCcw, Search, SlidersHorizontal, Smile, Undo2, Upload, Wifi, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import DevicePreview from './DevicePreview'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Input } from './ui/input'
import { colorHex, defaultDesign, designFor, designSchema, validateDesign, sansLine, type DesignField, type Designs } from '../lib/design'
import { moduleNames, type ModuleId, type StudioSnapshot } from '../lib/studio'
import './designer.css'

const modules:ModuleId[]=['face','usage','hey','clock','roon']
const icons={face:Smile,usage:Activity,hey:Mail,clock:Clock,roon:Music2}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)
const draftKey='companion-designer-draft-v1'
function readDraft(current:Designs):Designs {
 try{const cached=JSON.parse(sessionStorage.getItem(draftKey)||'null');if(!cached)return current
 const value=validateDesign(cached.design),base=validateDesign(cached.base),next=structuredClone(current)
 for(const m of modules)for(const f of designSchema[m])if(value[m][f.key]!==base[m][f.key])next[m][f.key]=value[m][f.key]
 return next
 }catch{return current}
}
function rememberDraft(value:Designs,base:Designs){try{if(equal(value,base))sessionStorage.removeItem(draftKey);else sessionStorage.setItem(draftKey,JSON.stringify({design:value,base}))}catch{/* The editor remains usable if browser storage is unavailable. */}}

type SaveState='saved'|'editing'|'saving'|'error'

export default function Designer({snapshot:s,online,pending,action}:{snapshot:StudioSnapshot;online:boolean;pending:boolean;action:(path:string,payload:unknown,message?:string)=>Promise<boolean>}){
 const [module,setModule]=useState<ModuleId>(s.module)
 const currentDesign=Object.fromEntries(modules.map(m=>[m,designFor(s.settings.design,m)])) as Designs
 const [draft,setDraft]=useState<Designs>(()=>readDraft(currentDesign))
 const [live,setLive]=useState(()=>{try{return sessionStorage.getItem('companion-designer-live')!=='false'}catch{return true}})
 const [state,setState]=useState<SaveState>(()=>equal(draft,currentDesign)?'saved':'editing')
 const [error,setError]=useState('')
 const [search,setSearch]=useState('')
 const [guides,setGuides]=useState(false)
 const [sample,setSample]=useState(false)
 const [history,setHistory]=useState<Designs[]>([])
 const desired=useRef(draft),saved=useRef(currentDesign),inFlight=useRef(false),mounted=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const liveRef=useRef(live),onlineRef=useRef(online),dirty=useRef(!equal(draft,currentDesign))
 const [choosing,setChoosing]=useState(false)
 const choosingRef=useRef(false)
 const ackRevision=useRef(s.settingsRevision)
 const importInput=useRef<HTMLInputElement>(null)
 liveRef.current=live;onlineRef.current=online
 const commitRef=useRef<()=>Promise<void>>(async()=>{})
 commitRef.current=async()=>{
  if(inFlight.current||!onlineRef.current||!dirty.current)return
  inFlight.current=true
  if(mounted.current){setState('saving');setError('')}
  try{
   while(dirty.current&&onlineRef.current){
    const value=structuredClone(desired.current)
    const response=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:value})})
    const body=await response.json()
    if(!response.ok)throw Error(body.error||'Could not save this design.')
    saved.current=value;ackRevision.current=Math.max(ackRevision.current,body.settingsRevision??0);dirty.current=!equal(value,desired.current);if(mounted.current)rememberDraft(desired.current,value)
    if(!mounted.current||!liveRef.current)break
   }
   if(mounted.current)setState(dirty.current?'editing':'saved')
  }catch(e){if(mounted.current){setState('error');setError(e instanceof Error?e.message:'Could not reach the bridge.')}}
  finally{inFlight.current=false}
 }
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(timer.current)clearTimeout(timer.current);if(liveRef.current)void commitRef.current()}},[])
 useEffect(()=>{
  if(!dirty.current&&!inFlight.current&&s.settingsRevision>=ackRevision.current&&s.settings.design){const value=structuredClone(s.settings.design) as Designs;saved.current=value;desired.current=value;setDraft(value)}
 },[s.settingsRevision])
 useEffect(()=>{try{sessionStorage.setItem('companion-designer-live',String(live))}catch{};if(!live&&timer.current)clearTimeout(timer.current);if(online&&live&&dirty.current)void commitRef.current()},[online,live])
 function replace(value:Designs,remember=true){
  if(equal(value,desired.current))return
  if(remember)setHistory(h=>[...h.slice(-39),structuredClone(desired.current)])
  desired.current=value;dirty.current=!equal(value,saved.current);rememberDraft(value,saved.current);setDraft(value);setState(dirty.current?'editing':'saved')
  if(timer.current)clearTimeout(timer.current)
  if(liveRef.current&&onlineRef.current)timer.current=setTimeout(()=>{if(liveRef.current)void commitRef.current()},180)
 }
 function change(key:string,value:number){replace({...desired.current,[module]:{...desired.current[module],[key]:value}})}
 function undo(){const previous=history.at(-1);if(previous){setHistory(h=>h.slice(0,-1));replace(previous,false)}}
 async function choose(id:ModuleId){if(choosingRef.current)return;setModule(id);setSearch('');if(s.settings.modules[id].enabled&&online){choosingRef.current=true;setChoosing(true);try{if(!await action('module',{id}))setModule(s.module)}finally{choosingRef.current=false;setChoosing(false)}}}
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,design:desired.current},null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='companion-design.json';a.click();URL.revokeObjectURL(url)}
 async function importFile(file:File|undefined){if(!file)return;try{if(file.size>64000)throw Error('This design file is too large.');const value=JSON.parse(await file.text());if(value.version!==1)throw Error('Unsupported design version.');replace(validateDesign(value.design));toast.success('Design imported')}catch(e){toast.error(e instanceof Error?e.message:'Could not read this design.')}finally{if(importInput.current)importInput.current.value=''}}
 const fields=designSchema[module].filter(f=>f.type!=='color').filter(f=>`${f.label} ${f.group}`.toLowerCase().includes(search.toLowerCase()))
 const groups=[...new Set(fields.map(f=>f.group))].sort((a,b)=>a==='Animation'?-1:b==='Animation'?1:0)
 const selected=draft[module]
 const preview=structuredClone(s)
 preview.settings.design=draft as typeof s.settings.design
 preview.module=module
 const sampleContent=sample||module==='hey'&&draft.hey.rows!==s.settings.design?.hey.rows||s.module!==module||module!=='face'&&s.display.dashboard?.status!=='ready'
 if(sampleContent){
  preview.display=module==='face'?{state:'working',label:'3 Working',name:'Building something good',nameShimmer:true}:module==='usage'?{state:'idle',label:'',name:'',dashboard:{status:'ready',title:'CodexBar',detail:'',pageIndex:0,pageCount:1,primary:{provider:'Codex',label:'Session',remaining:73,reset:'Resets in 2h 14m'},secondary:{provider:'Claude',label:'Weekly',remaining:42,reset:'Resets in 4d 6h'}}}:module==='roon'?{state:'idle',label:'',name:'',dashboard:{status:'ready',title:'Roon',detail:'',track:'A little music',artist:'Your favourite artist',playing:true,canPrevious:true,canNext:true}}:module==='clock'?{state:'idle',label:'',name:'',dashboard:{status:'ready',title:'Clock',detail:'',blinkSeparator:s.settings.modules.clock.blinkSeparator,time:s.settings.modules.clock.hourFormat==='24'?'17:20':'5:20',weekday:s.settings.modules.clock.showWeekday?'Wed':''}}:{state:'idle',label:'',name:'',dashboard:{status:'ready',title:'HEY',detail:'',pageIndex:0,pageCount:1,items:[{sender:'Alex Morgan',subject:'A few thoughts on the new companion'},{sender:'Studio team',subject:'Your design review is ready for Friday'},{sender:'Sam Taylor',subject:'See you tomorrow'}].slice(0,selected.rows)}}
 }
 const changed=designSchema[module].filter(f=>f.type!=='color'&&selected[f.key]!==f.default).length
 const overflow=module==='hey'&&(selected.y+(selected.rows-1)*(selected.height+selected.gap)+Math.max(selected.height,selected.subjectY+selected.lines*sansLine(selected.subjectSize))>405)||module==='usage'&&(selected.x+selected.width>446||selected.height+selected.rowGap+selected.resetY+103+selected.offsetY>405)||module==='clock'&&(selected.x+selected.width>466||selected.dayY+34>440)
 return <section className="designer" aria-label="Module designer">
  <div className="designer-toolbar">
   <div className="designer-save-state" role="status">{!online?<WifiOff size={14}/>:state==='saved'?<Check size={14}/>:<span className={`designer-save-dot ${state}`}/>}<span>{!online?'Offline - preview available':state==='saving'?'Saving design':state==='error'?'Changes not saved':state==='editing'?live?'Changes queued':'Preview changes':'All changes saved'}</span></div>
   <div className="designer-tools"><Button variant="ghost" size="sm" onClick={undo} disabled={!history.length}><Undo2 size={14}/>Undo</Button><Button variant="ghost" size="sm" disabled={!changed} onClick={()=>replace({...desired.current,[module]:structuredClone(defaultDesign[module])})}><RotateCcw size={14}/>Reset module</Button><span className="designer-tool-separator"/><label className="designer-live"><Wifi size={14}/><span>Live updates</span><Switch checked={live} onCheckedChange={setLive} aria-label="Live design updates"/></label>{(!live||state==='error')&&<Button size="sm" disabled={!online||state==='saving'||!dirty.current} onClick={()=>void commitRef.current()}>{state==='error'?'Retry':'Apply design'}</Button>}</div>
  </div>
  {s.device.fontError&&<div className="designer-error" role="alert">The device could not load the requested font size. Try another size or reset the property.</div>}
  {error&&<div className="designer-error" role="alert">{error} Your edits remain in the preview.</div>}
  <div className="designer-workspace">
   <nav className="designer-modules" aria-label="Design module"><span className="designer-label">Modules</span>{modules.map(id=>{const Icon=icons[id];return <button key={id} className={module===id?'selected':''} aria-pressed={module===id} disabled={choosing} onClick={()=>void choose(id)}><Icon size={18}/><span>{moduleNames[id]}<small>{id==='face'?'Status and session':id==='usage'?'Balances and progress':id==='hey'?'Senders and subjects':id==='roon'?'Artwork and playback':'Time and weekday'}</small></span></button>})}<div className="designer-files"><Button variant="ghost" size="sm" onClick={download}><Download size={14}/>Export design</Button><Button variant="ghost" size="sm" onClick={()=>importInput.current?.click()}><Upload size={14}/>Import design</Button><input ref={importInput} type="file" accept=".json,application/json" hidden onChange={e=>void importFile(e.target.files?.[0])}/></div></nav>
   <div className="designer-canvas">
    <div className="designer-canvas-header"><span>{moduleNames[module]}<small>{sampleContent?'Sample content':'Live content'}</small></span><button className={guides?'selected':''} title="Toggle layout guides" aria-label="Show layout guides" aria-pressed={guides} onClick={()=>setGuides(!guides)}><Grid2X2 size={16}/></button></div>
    <div className={`designer-stage ${guides?'with-guides':''}`}><DevicePreview snapshot={preview} online={true} pending={pending||!online} onModule={id=>void choose(id)} onLive={()=>setSample(false)} onUsagePage={direction=>void action('usage/page',{direction})} onHeyPage={direction=>void action('hey/page',{direction})} onOpenCard={sampleContent?undefined:request=>void action('open-card',request)} onRoonControl={sampleContent?undefined:control=>void action('roon/control',{action:control})} onRoonView={sampleContent?undefined:expanded=>void action('roon/view',{expanded})}/></div>
    <div className="designer-canvas-footer"><label><input type="checkbox" checked={sample} onChange={e=>setSample(e.target.checked)}/>Use sample content</label><span>466 x 466 px</span></div>
    <p className="designer-canvas-note"><CircleHelp size={14}/>{sampleContent?(live?'Sample preview. Design changes sync.':'Sample preview. Live updates paused.'):live?'Adjust a value to see it here and on your device.':'Live updates are paused. Apply when your design is ready.'}</p>
    {overflow&&<p className="designer-overflow" role="status">Some content may sit outside the screen. Use guides to check its position.</p>}
   </div>
   <aside className="designer-inspector" aria-label={`${moduleNames[module]} properties`}><div className="designer-inspector-header"><div><SlidersHorizontal size={15}/><h2>Properties</h2>{changed>0&&<span>{changed} changed</span>}</div><div className="designer-search"><Search size={14}/><Input placeholder="Find a property" aria-label="Find a design property" value={search} onChange={e=>setSearch(e.target.value)}/></div></div><div className="designer-property-list">{!search&&<section className="designer-group"><h3>Display</h3><a className="designer-related-link" href="#device">Edit device colours in Device appearance</a>{(module==='usage'||module==='hey')&&<label className="designer-display-switch">Card backgrounds<Switch checked={s.settings.device.showCardBackgrounds} disabled={!online} aria-label="Designer card backgrounds" onCheckedChange={value=>void action('settings',{device:{showCardBackgrounds:value}})}/></label>}{module==='clock'&&<><label className="designer-display-switch">24-hour time<Switch checked={s.settings.modules.clock.hourFormat==='24'} disabled={!online} aria-label="Designer 24-hour time" onCheckedChange={value=>void action('settings',{modules:{clock:{hourFormat:value?'24':'12'}}})}/></label><label className="designer-display-switch">Show weekday<Switch checked={s.settings.modules.clock.showWeekday} disabled={!online} aria-label="Designer show weekday" onCheckedChange={value=>void action('settings',{modules:{clock:{showWeekday:value}}})}/></label><label className="designer-display-switch">Blink separator<Switch checked={s.settings.modules.clock.blinkSeparator} disabled={!online} aria-label="Designer blink separator" onCheckedChange={value=>void action('settings',{modules:{clock:{blinkSeparator:value}}})}/></label></>}{module==='roon'&&<a className="designer-related-link" href="#modules">Choose a Roon zone</a>}{module==='face'&&<a className="designer-related-link" href="#animations">Edit animation mappings</a>}</section>}{groups.map(group=><section className="designer-group" key={group}><h3>{group}</h3>{fields.filter(f=>f.group===group).map(field=><DesignControl key={`${module}-${field.key}`} field={field} autoValue={s.settings.device.showCardBackgrounds?44:56} value={selected[field.key]} onChange={value=>change(field.key,value)}/>)}</section>)}{!fields.length&&<p className="designer-no-results">No matching properties.</p>}</div><div className="designer-inspector-foot">{designSchema[module].filter(field=>field.type!=='color').length} controls <span>Device fonts: Geist and Geist Pixel Circle</span></div></aside>
  </div>
 </section>
}

function DesignControl({field:f,value,onChange,autoValue=56}:{field:DesignField;value:number;onChange:(value:number)=>void;autoValue?:number}){
 const id=`design-${f.key}`
 const automatic=f.allowAuto&&value===0
 const displayed=automatic?autoValue:value
 const [text,setText]=useState(String(displayed))
 useEffect(()=>setText(String(displayed)),[displayed])
 const label=(n:number)=>f.key==='align'?['Left','Centre','Right'][n]:f.key==='barStyle'?['Solid','Square pixels','Circle pixels'][n]:String(n)
 return <div className={`designer-control ${f.type==='color'?'is-colour':''}`}><div className="designer-control-label"><label htmlFor={id}>{f.label}{f.unit&&<span className="designer-unit">{f.unit}</span>}</label>{value!==f.default&&<button title={`Reset ${f.label.toLowerCase()}`} aria-label={`Reset ${f.label.toLowerCase()}`} onClick={()=>onChange(f.default)}><RotateCcw size={11}/></button>}</div>{f.allowAuto&&<label className="designer-auto-size">Automatic<Switch checked={!!automatic} aria-label={`Automatic ${f.label.toLowerCase()}`} onCheckedChange={enabled=>onChange(enabled?0:autoValue)}/></label>}{f.type==='toggle'?<Switch id={id} checked={value===1} aria-label={f.label} onCheckedChange={enabled=>onChange(enabled?1:0)}/>:f.type==='color'?<div className="designer-colour-value"><input id={id} type="color" value={colorHex(value)} onChange={e=>onChange(parseInt(e.target.value.slice(1),16))}/><span>{colorHex(value).toUpperCase()}</span></div>:f.options?<select id={id} value={value} onChange={e=>onChange(Number(e.target.value))}>{f.options.map(n=><option key={n} value={n}>{label(n)}</option>)}</select>:<div className="designer-number"><input type="range" min={f.min} max={f.max} step={1} value={displayed} disabled={!!automatic} aria-label={`${f.label} slider`} onChange={e=>onChange(Number(e.target.value))}/><input id={id} type="number" min={f.min} max={f.max} value={text} disabled={!!automatic} onChange={e=>{setText(e.target.value);const n=Number(e.target.value);if(e.target.value!==''&&Number.isInteger(n)&&n>=f.min&&n<=f.max)onChange(n)}} onBlur={()=>setText(String(displayed))}/></div>}</div>
}
