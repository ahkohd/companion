import CompanionMark from './components/CompanionMark'
import { version as appVersion } from '../package.json'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Activity, Bell, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Clock, Cpu, Download, Eye, LayoutDashboard, Mail, Monitor, Music2, Volume2, Moon, Sun, MousePointer2, Play, Plus, Radio, RefreshCw, RotateCcw, Search, Settings2, Shapes, SlidersHorizontal, Smile, Sparkles, Unplug, Wifi, X, type LucideIcon } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { Input } from './components/ui/input'
import { Switch } from './components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './components/ui/dialog'
import DevicePreview from './components/DevicePreview'
import PhysicalRotation from './components/PhysicalRotation'
import SerialConnection from './components/SerialConnection'
import DeviceAppearance from './components/DeviceAppearance'
import Designer from './components/Designer'
import Attention from './components/Attention'
import Logs from './components/Logs'
import AppSettings from './components/AppSettings'
import RoonSettings from './components/RoonSettings'
import AudioSettings from './components/AudioSettings'
import Face from './components/face/Face'
import { animationName, animations, boxes, moduleNames, relativeTime, resetTime, statusDescriptions, statusNames, useStudio, type ModuleId, type Source, type Status, type StudioSnapshot } from './lib/studio'

const navigation: {id:Page;label:string;icon:LucideIcon;description:string}[] = [
  {id:'overview',label:'Overview',icon:LayoutDashboard,description:'A little presence for everything you are working on.'},
  {id:'animations',label:'Animations',icon:Smile,description:'Give every moment a little personality.'},
  {id:'modules',label:'Modules',icon:Shapes,description:''},
  {id:'attention',label:'Attention',icon:Bell,description:'The right message, at the right moment.'},
  {id:'designer',label:'Designer',icon:Settings2,description:'Shape every detail of your companion.'},
  {id:'logs',label:'Logs',icon:Activity,description:'Live diagnostics from your companion.'},
  {id:'device',label:'Device',icon:SlidersHorizontal,description:'Make your companion feel right at home.'},
  {id:'app-settings',label:'Settings',icon:Settings2,description:'Startup, updates, command line and agent skills.'},
]
type Page = 'overview' | 'animations' | 'modules' | 'device' | 'designer' | 'attention' | 'logs' | 'app-settings'
const moduleIcons = {face:Smile,usage:Activity,hey:Mail,clock:Clock,roon:Music2,audio:Volume2}
const statusList: Status[] = ['working','blocked','done','idle','unknown','disconnected']
const readPage = (): Page => navigation.some(n => n.id === location.hash.slice(1)) ? location.hash.slice(1) as Page : 'overview'
type Save = (patch: unknown, message?: string) => Promise<boolean>
type Action = (path:string,payload:unknown,message?:string) => Promise<boolean>
interface PageProps { snapshot: StudioSnapshot; pending:boolean; save:Save; action:Action }

function StatusDot({state='idle'}:{state?:string}) { return <span aria-hidden="true" className={`state-dot state-${state}`} /> }
function Eyebrow({children}:{children:ReactNode}) { return <p className="eyebrow">{children}</p> }
function Panel({title,description,action,children,className=''}:{title?:string;description?:string;action?:ReactNode;children:ReactNode;className?:string}) {
  return <section className={`panel ${className}`}>{title && <div className="panel-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}{children}</section>
}
function SelectField({label,value,onChange,children,disabled=false,compact=false}:{label:string;value:string|number;onChange:(value:string)=>void;children:ReactNode;disabled?:boolean;compact?:boolean}) {
  const id = useId()
  return <div className={`select-field ${compact?'compact':''}`}><label htmlFor={id}>{label}</label><div className="select-wrap"><select id={id} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>{children}</select><ChevronDown size={14} aria-hidden="true" /></div></div>
}
function SettingRow({title,description,children}:{title:string;description:string;children:ReactNode}) {
  return <div className="setting-row"><div><h3>{title}</h3><p>{description}</p></div><div className="setting-control">{children}</div></div>
}
function SourceBadge({source,enabled,network=false}:{source:Source;enabled:boolean;network?:boolean}) {
  const label = !network && source.installed === false ? 'CLI not found' : !network && source.installed === null ? 'Detecting CLI' : !enabled ? network ? 'Off' : 'CLI detected' : source.refreshing && source.status === 'ready' ? 'Checking' : source.status === 'ready' ? 'Connected' : source.status === 'loading' ? 'Connecting' : source.status === 'auth-required' ? network ? 'Permission needed' : 'Sign in needed' : 'Needs attention'
  return <Badge variant="secondary" className={`source-badge ${source.status==='ready'&&enabled?'is-good':''}`}><StatusDot state={source.refreshing||source.status==='loading'?'working':source.status==='ready'&&enabled?'connected':'idle'} />{label}</Badge>
}
function Thumbnail({id,className=''}:{id:string|null;className?:string}) {
  const clip = animations.find(a => a.id === id)
  return <div className={`animation-thumb ${className}`} aria-hidden="true">{clip?.source ? <img src={`/thumbnails/${clip.source}.png`} alt="" width="192" height="168" loading="lazy" /> : <div className={`mini-eyes mini-${id||'idle'}`}><i /><i /></div>}</div>
}

export default function App() {
  const {snapshot,online,pending,action:bridgeAction,save} = useStudio()
  const [page,setPage] = useState<Page>(readPage)
  const [localAnimation,setLocalAnimation] = useState<string|undefined>()
  const [localReplay,setLocalReplay] = useState(0)
  const audition=(id:string|undefined)=>{setLocalAnimation(id);setLocalReplay(value=>value+1)}
  const action:Action=async(path,payload,message)=>{const saved=await bridgeAction(path,payload,message);if(saved&&['select','module','expression'].includes(path))setLocalAnimation(undefined);return saved}
  const [help,setHelp] = useState(false)
  useEffect(()=>{ const onHash=()=>setPage(readPage()); window.addEventListener('hashchange',onHash); return ()=>window.removeEventListener('hashchange',onHash) },[])
  const deviceConnected = online && snapshot?.device.status === 'connected'
  const connectionLabel = !online ? 'Connecting' : deviceConnected ? 'Connected' : 'Device disconnected'
  const appearance = snapshot?.settings.appearance
  useEffect(()=>{
    const query=matchMedia('(prefers-color-scheme: dark)')
    const apply=()=> { document.documentElement.classList.toggle('dark',appearance?.theme==='dark'||appearance?.theme==='system'&&query.matches); document.documentElement.dir=appearance?.direction||'ltr'; document.documentElement.dataset.reduced=String(appearance?.reducedMotion||false) }
    apply();query.addEventListener('change',apply);return()=>query.removeEventListener('change',apply)
  },[appearance?.theme,appearance?.direction,appearance?.reducedMotion])
  const navigate=(next:Page)=>{location.hash=next;setPage(next)}
  const current=navigation.find(n=>n.id===page)!
  const switchModule = (id:ModuleId) => { setLocalAnimation(undefined); void action('module',{id},`${moduleNames[id]} is on your device`) }
  const returnLive = () => { setLocalAnimation(undefined); if(snapshot?.expression!==null) void action('expression',{expression:null},'Following live agent states') }
  return <div className="studio-shell">
    <a className="skip-link" href="#main" onClick={event=>{event.preventDefault();document.getElementById('main')?.focus()}}>Skip to content</a>
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Companion home"><CompanionMark/><span>Companion</span></a>
      <p className="nav-label">Workspace</p>
      <nav aria-label="Main navigation">{navigation.filter(item=>item.id!=='app-settings').map(({id,label,icon:Icon})=><a key={id} href={`#${id}`} className={`nav-link ${page===id?'active':''}`} aria-label={label} aria-current={page===id?'page':undefined}><Icon size={18}/><span>{label}</span></a>)}</nav>
      <div className="sidebar-bottom"><button className="help-button" onClick={()=>setHelp(true)}><CircleHelp size={17}/>Quick guide<ArrowUpRight size={14}/></button><a href="#app-settings" className={`nav-link sidebar-settings ${page==='app-settings'?'active':''}`} aria-label="Settings" aria-current={page==='app-settings'?'page':undefined}><Settings2 size={18}/><span>Settings</span></a><div className="sidebar-version">Companion <span>v{appVersion}</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={13}/><span>{current.label}</span></div><div className="topbar-actions"><div className="topbar-status" role="status"><StatusDot state={deviceConnected?'connected':'idle'}/>{connectionLabel}</div><div className="theme-controls" role="group" aria-label="Colour theme"><button aria-label="Use light theme" aria-pressed={appearance?.theme==='light'} disabled={pending||!online} onClick={()=>void save({appearance:{theme:'light'}})}><Sun size={14}/></button><button aria-label="Use dark theme" aria-pressed={appearance?.theme==='dark'} disabled={pending||!online} onClick={()=>void save({appearance:{theme:'dark'}})}><Moon size={14}/></button></div></div></header>
      {!online&&snapshot&&<div className="offline-banner" role="status"><Unplug size={16}/>Reconnecting to Companion. Showing the last received state. Changes are paused.</div>}
      <main id="main" tabIndex={-1} className="main-content">
        <div className="page-heading"><div><h1>{current.label}</h1><p aria-hidden={current.description ? undefined : true}>{current.description || '\u00a0'}</p></div>{page!=='app-settings'&&<Badge variant="outline" className="device-badge"><Cpu size={13}/>{snapshot?.device.profile ? `${snapshot.device.profile.display.width} x ${snapshot.device.profile.display.height}` : '1.75" AMOLED'}</Badge>}</div>
        {page==='app-settings'?<AppSettings/>:page==='logs'?<Logs/>:page==='designer'&&snapshot?<Designer snapshot={snapshot} online={online} pending={pending} action={action}/>:<div className="content-grid"><div className="page-content">
          {!snapshot ? <div className="loading-panel" role="status"><CompanionMark/><h2>Waking things up</h2><p>Connecting to your local companion bridge.</p><p className="muted-small">If this takes a moment, check that the bridge is running.</p></div> : <>
            {page==='overview'&&<Overview snapshot={snapshot} pending={pending||!online} action={action} save={save} navigate={navigate}/>}
            {page==='animations'&&<Animations snapshot={snapshot} pending={pending||!online} action={action} save={save} audition={audition} auditionId={localAnimation}/>}
            {page==='modules'&&<Modules snapshot={snapshot} pending={pending||!online} action={action} save={save}/>}
            {page==='attention'&&<Attention snapshot={snapshot} pending={pending||!online} action={action}/>}
            {page==='device'&&<DeviceSettings snapshot={snapshot} pending={pending||!online} action={action} save={save}/>}
          </>}
        </div><aside className="preview-column" aria-label="Live device preview"><DevicePreview snapshot={snapshot} online={online} pending={pending||!online} localAnimation={localAnimation} localReplay={localReplay} onModule={switchModule} onLive={returnLive} onUsagePage={direction=>void action('usage/page',{direction})} onHeyPage={direction=>void action('hey/page',{direction})} onOpenCard={request=>void action('open-card',request)} onRoonControl={(control,player)=>void action('roon/control',{action:control,player})} onRoonPage={direction=>void action('roon/player',{direction})} onRoonView={expanded=>void action('roon/view',{expanded})} onAudioControl={request=>void action('audio/control',request)} onAudioView={request=>void action('audio/view',request)} onAudioPage={direction=>void action('audio/page',{direction})}/>{localAnimation!==undefined&&<div className="audition-actions"><div><Eye size={15}/><span>Previewing <strong>{animationName(localAnimation)}</strong></span></div><Button disabled={pending||!online||!snapshot?.settings.modules.face.enabled} onClick={async()=>{if(await action('expression',{expression:localAnimation},'Animation sent to your device'))setLocalAnimation(undefined)}}><Play size={14}/>Send to device</Button></div>}</aside></div>}
      </main>
    </div>
    <Dialog open={help} onOpenChange={setHelp}><DialogContent className="guide-dialog"><DialogHeader><DialogTitle>A little companion for your desk</DialogTitle><DialogDescription>Everything runs through the local bridge on this computer.</DialogDescription></DialogHeader><ol className="guide-steps"><li><span>01</span><div><h3>Connect your screen</h3><p>Plug your Waveshare in over USB. Device settings show its connection status.</p></div></li><li><span>02</span><div><h3>Choose what matters</h3><p>Enable Herdr Face, CodexBar, HEY or Clock in Modules. Installed CLIs are detected automatically.</p></div></li><li><span>03</span><div><h3>Make it yours</h3><p>Map animations to agent states. Swipe left or right on the device to switch enabled modules; tap the face to cycle agents.</p></div></li></ol><p className="guide-footnote">HEY shows senders and subjects without reading message bodies. The studio cannot send email or change your inbox.</p></DialogContent></Dialog>
    <Toaster position="bottom-right" closeButton theme={appearance?.theme as 'light'|'dark'|'system'||'light'}/>
  </div>
}

function Overview({snapshot:s,pending,action,navigate}:PageProps&{navigate:(page:Page)=>void}) {
  const [search,setSearch]=useState('')
  const counts={working:0,done:0,idle:0,blocked:0}
  for(const agent of s.agents) if(agent.state in counts) counts[agent.state as keyof typeof counts]++
  const agents=s.agents.filter(a=>`${a.name} ${a.project} ${a.kind}`.toLowerCase().includes(search.toLowerCase()))
  return <>
    <div className="overview-summary"><div className="summary-icon"><Sparkles size={21}/></div><div><h2>{counts.blocked?'A little attention needed':counts.working?'Good things are in progress':counts.done?'Something is ready for you':'A quiet moment at your desk'}</h2><p>{!s.connected?'Connect Herdr to see your agents here.':counts.blocked?`${counts.blocked} ${counts.blocked===1?'agent is':'agents are'} waiting for your input.`:counts.working?`${counts.working} ${counts.working===1?'agent is':'agents are'} working. Your companion is keeping you company.`:counts.done?'Your agents have work ready to review.':'Your companion will light up when things get moving.'}</p></div></div>
    <div className="stats-grid">{(['working','done','idle'] as const).map(state=><div className="stat" key={state}><div><StatusDot state={state}/>{statusNames[state]}</div><strong>{counts[state]}</strong></div>)}</div>
    <Panel title="Your agents" description="Choose an agent to follow on your screen." action={<Badge variant="secondary" className={s.connected?'is-good':''}><StatusDot state={s.connected?'connected':'idle'}/>{s.connected?'Herdr live':'Offline'}</Badge>}>
      <div className="agent-search"><Search size={16}/><Input aria-label="Search agents" placeholder="Find an agent or project" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <button className={`all-agents-row ${s.selected==='all'&&s.module==='face'?'selected':''}`} disabled={pending||!s.settings.modules.face.enabled} onClick={()=>void action('select',{id:'all'})}><span className="all-agents-icon"><LayoutDashboard size={18}/></span><span><strong>All agents</strong><small>The bigger picture, at a glance</small></span><span className="agent-count">{s.agents.length}</span>{s.selected==='all'&&s.module==='face'?<span className="selected-check"><Check size={12}/></span>:<ChevronRight size={16}/>}</button>
      <div className="agent-list">{agents.length?agents.map(agent=><button key={agent.id} className={`agent-row ${s.selected===agent.id&&s.module==='face'?'selected':''}`} disabled={pending||!s.settings.modules.face.enabled} onClick={()=>void action('select',{id:agent.id})}><span className={`agent-avatar agent-${agent.kind.toLowerCase()}`}>{agent.kind.slice(0,1).toUpperCase()}</span><span className="agent-info"><strong>{agent.name}</strong><small>{agent.project||'No project'}<span>/</span>{agent.kind}</small></span><span className="agent-state"><StatusDot state={agent.state}/>{statusNames[agent.state]||agent.state}</span>{s.selected===agent.id&&s.module==='face'&&<Check size={14}/>}</button>):<div className="empty-state"><Radio size={25}/><h3>{search?'No matching agents':s.connected?'Room for your next idea':'Waiting for Herdr'}</h3><p>{search?'Try a different name or project.':s.connected?'Start an agent in Herdr and it will appear here.':'Open Herdr on this computer. Your agents will appear as soon as it connects.'}</p></div>}</div>
      <div className="panel-footnote"><CircleHelp size={13}/>{s.settings.modules.face.enabled?'Tap the face on your device to cycle through agents.':'Enable Herdr Face in Modules to follow agents on your device.'}</div>
    </Panel>
    <Panel title="More than a face" description="Bring the rest of your day into view." className="module-shortcuts">{(['usage','hey','clock','roon','audio'] as const).map(id=>{
      const Icon=moduleIcons[id]
      return <button className="shortcut-row" key={id} onClick={()=>navigate('modules')}>
        <span className={`module-icon module-${id}`}><Icon size={19}/></span>
        <span><strong>{moduleNames[id]}</strong><small>{id==='usage'?'Your AI usage, at a glance':id==='hey'?'A quieter view of your inbox':id==='roon'?'Your music, within reach':id==='audio'?'Sound, at your fingertips':'A little space for the time'}</small></span>
        {id==='audio'?<Badge variant="secondary">Mac audio</Badge>:id==='clock'?<Badge variant="secondary">Built in</Badge>:<SourceBadge source={s.modules[id]} enabled={s.settings.modules[id].enabled} network={id==='roon'}/>}
        <ChevronRight size={16}/>
      </button>
    })}</Panel>
  </>
}

function Animations({snapshot:s,pending,save,audition,auditionId}:PageProps&{audition:(id:string|undefined)=>void;auditionId:string|undefined}) {
  const [tab,setTab]=useState<'mappings'|'library'>('mappings')
  const [search,setSearch]=useState('')
  const [group,setGroup]=useState('All')
  const [mapping,setMapping]=useState<Status|null>(null)
  const [choice,setChoice]=useState<string|null>(null)
  const [dialogSearch,setDialogSearch]=useState('')
  const [auditionClock,setAuditionClock]=useState(()=>({changedAt:Date.now(),animationMs:performance.now()}))
  const filtered=animations.filter(a=>(group==='All'||a.group===group)&&a.label.toLowerCase().includes(search.toLowerCase()))
  const openMapping=(state:Status)=>{setMapping(state);setChoice(s.settings.mappings[state]);setDialogSearch('');setAuditionClock({changedAt:Date.now(),animationMs:performance.now()})}
  const choose=(id:string|null)=>{setChoice(id);setAuditionClock({changedAt:Date.now(),animationMs:performance.now()})}
  return <>
    <div className="segmented-tabs" role="group" aria-label="Animation views">{(['mappings','library'] as const).map(id=><button key={id} aria-pressed={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{id==='mappings'?'Status mappings':'Animation library'}{id==='library'&&<span>52</span>}</button>)}</div>
    {tab==='mappings'?<><Panel title="A face for every state" description="Your chosen animation plays automatically when a status changes." action={<Settings2 size={17} className="muted"/>}>{statusList.map(state=><div className="mapping-row" key={state}><div className="mapping-info"><h3>{statusNames[state]}</h3><p>{statusDescriptions[state]}</p></div><button className="mapping-choice" onClick={()=>openMapping(state)} disabled={pending}><Thumbnail id={s.settings.mappings[state]??state}/><span>{animationName(s.settings.mappings[state])}</span><ChevronDown size={14}/></button></div>)}</Panel><div className="information-note"><CircleHelp size={16}/><p>Mappings change the expression. Your status and session title stay in place. Default idle gently falls asleep after 30 seconds.</p></div><Button variant="ghost" className="quiet-reset" disabled={pending||!Object.values(s.settings.mappings).some(Boolean)} onClick={()=>void save({mappings:Object.fromEntries(statusList.map(id=>[id,null]))},'Default animations restored')}><RotateCcw size={14}/>Restore default mappings</Button></>:<><div className="library-toolbar"><div className="search-field"><Search size={16}/><Input aria-label="Search animations" placeholder="Find an expression" value={search} onChange={e=>setSearch(e.target.value)}/></div><SelectField compact label="Collection" value={group} onChange={setGroup}>{['All','Originals','States','Actions'].map(g=><option key={g}>{g}</option>)}</SelectField></div><div className="library-grid">{filtered.map(clip=><button key={clip.id} className={`animation-card ${auditionId===clip.id?'selected':''}`} onClick={()=>audition(clip.id)} aria-label={`Preview ${clip.label}`} aria-pressed={auditionId===clip.id}><Thumbnail id={clip.id}/><div><strong>{clip.label}</strong><small>{clip.group}</small><span className="animation-play">{auditionId===clip.id?<Check size={14}/>:<Play size={13}/>}</span></div></button>)}</div>{!filtered.length&&<div className="empty-state"><Search size={24}/><h3>No expressions found</h3><p>Try another word or choose all collections.</p></div>}<p className="library-note">Choose an expression to preview it, then send it to your device or assign it in Status mappings.</p></>}
    <Dialog open={mapping!==null} onOpenChange={open=>{if(!open)setMapping(null)}}><DialogContent className="mapping-dialog"><DialogHeader><DialogTitle>When {mapping?statusNames[mapping].toLowerCase():''}, show...</DialogTitle><DialogDescription>Choose an animation for this status. Save when it feels right.</DialogDescription></DialogHeader><div className="mapping-audition"><div className="mapping-face device-preview"><div className="device-screen" dir="ltr"><Face key={auditionClock.changedAt} state={choice?.startsWith('grok:')?'idle':choice??mapping??'idle'} animation={choice?.startsWith('grok:')?choice:null} changedAt={auditionClock.changedAt} animationMs={auditionClock.animationMs} ageMs={0} preview reduced={s.settings.appearance.reducedMotion}/></div></div><div><strong>{animationName(choice)}</strong><p>Preview this expression before saving it.</p><Button variant="ghost" size="sm" onClick={()=>setAuditionClock({changedAt:Date.now(),animationMs:performance.now()})}><RotateCcw size={12}/>Replay</Button></div></div><button className={`default-choice ${choice===null?'selected':''}`} onClick={()=>choose(null)}><RotateCcw size={17}/><span><strong>Default</strong><small>Use the companion's built-in expression</small></span>{choice===null&&<Check size={17}/>}</button><div className="search-field"><Search size={16}/><Input aria-label="Search mapping animations" placeholder="Search 52 animations" value={dialogSearch} onChange={e=>setDialogSearch(e.target.value)}/></div><div className="dialog-library">{animations.filter(a=>a.label.toLowerCase().includes(dialogSearch.toLowerCase())).map(clip=><button key={clip.id} className={`dialog-animation ${choice===clip.id?'selected':''}`} aria-pressed={choice===clip.id} onClick={()=>choose(clip.id)}><Thumbnail id={clip.id}/><span>{clip.label}</span>{choice===clip.id&&<Check size={13}/>}</button>)}</div><div className="dialog-actions"><span>{animationName(choice)}</span><Button variant="outline" onClick={()=>setMapping(null)}>Cancel</Button><Button disabled={pending} onClick={async()=>{if(mapping&&await save({mappings:{[mapping]:choice}},`${statusNames[mapping]} animation saved`)){setMapping(null);audition(undefined)}}}>Save mapping</Button></div></DialogContent></Dialog>
  </>
}

function Modules({snapshot:s,pending,save,action}:PageProps) {
  const [expanded,setExpanded]=useState<ModuleId|null>('usage')
  const order = s.settings.device.moduleOrder as ModuleId[]
  const enabled = order.filter(id=>s.settings.modules[id].enabled)
  const descriptions: Record<ModuleId,string> = {
    face:'A face for your agents. A feeling for their progress.',
    usage:'See what is left before your next reset.',
    hey:'Keep a little space for your inbox.',
    clock:'The time, with a little room to breathe.',
    roon:'Your music, within reach.',
    audio:'Control your microphone and speakers.',
  }
  const move=(id:ModuleId,direction:number)=>{
    const next=[...order], index=next.indexOf(id), target=index+direction
    if(index<0||target<0||target>=next.length)return
    ;[next[index],next[target]]=[next[target],next[index]]
    void save({device:{moduleOrder:next}},'Module order saved')
  }
  return <>
    <div className="section-intro"><span className="round-icon"><Shapes size={19}/></span><div><h2>One screen, your essentials</h2><p>Turn on the modules you want. Swipe between them on your device.</p></div><Badge variant="secondary">{enabled.length} enabled</Badge></div>
    <div className="module-cards">{order.map((id,index)=>{
      const Icon=moduleIcons[id], config=s.settings.modules[id]
      const source=id==='usage'||id==='hey'||id==='roon'?s.modules[id]:null
      return <Panel className={`module-card ${config.enabled?'enabled':''}`} key={id}>
        <div className="module-card-heading">
          <span className={`module-icon module-${id}`}><Icon size={23}/></span>
          <div><h2>{moduleNames[id]}{!source&&<span className="built-in">Built in</span>}</h2><p>{descriptions[id]}</p></div>
          <Switch checked={config.enabled} disabled={pending||(config.enabled&&enabled.length===1)} aria-label={`Enable ${moduleNames[id]}`} onCheckedChange={checked=>void save({modules:{[id]:{enabled:checked}}},`${moduleNames[id]} ${checked?'enabled':'disabled'}`)}/>
        </div>
        <div className="module-meta">
          {source?<SourceBadge source={source} enabled={config.enabled} network={id==='roon'}/>:id==='audio'?<Badge variant="secondary" className={config.enabled&&s.modules.audio?.status==='ready'?'is-good':''}>{!config.enabled?'Off':s.modules.audio?.status==='ready'?'Connected':'Unavailable'}</Badge>:id==='clock'?<Badge variant="secondary">Computer time</Badge>:<Badge variant="secondary" className={s.connected?'is-good':''}><StatusDot state={s.connected?'connected':'idle'}/>{s.connected?'Herdr connected':'Waiting for Herdr'}</Badge>}
          <span className="module-meta-note">{id==='audio'?(s.modules.audio?.deviceName||'Mac input and output'):id==='roon'?(s.modules.roon?.playerName||'Spotify, Apple Music, Roon and macOS'):source?.version?`CLI ${source.version}`:id==='face'?'Live agent states':id==='clock'?'Updates automatically':source?.installed===true?'Detected on this computer':source?.installed===false?'Install the CLI to connect':'Checking this computer'}</span>
          <div className="order-controls">
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${moduleNames[id]} earlier`} disabled={pending||index===0} onClick={()=>move(id,-1)}><ArrowUp size={13}/></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${moduleNames[id]} later`} disabled={pending||index===order.length-1} onClick={()=>move(id,1)}><ArrowDown size={13}/></Button>
          </div>
        </div>
        <div className="module-card-actions">
          <Button variant={s.module===id?'secondary':'outline'} disabled={!config.enabled||pending} onClick={()=>void action('module',{id},`${moduleNames[id]} is on your device`)}>{s.module===id?<Check size={14}/>:<Monitor size={14}/ >}{s.module===id?'On device':'Show on device'}</Button>
          {id!=='face'&&<Button variant="ghost" aria-expanded={expanded===id} onClick={()=>setExpanded(expanded===id?null:id)}>Configure<ChevronDown size={14} className={expanded===id?'turned':''}/></Button>}
        </div>
        {expanded===id&&id!=='face'&&<div className="module-details">{id==='usage'?<UsageSettings snapshot={s} pending={pending} save={save} action={action}/>:id==='hey'?<HeySettings snapshot={s} pending={pending} save={save} action={action}/>:id==='roon'?<RoonSettings snapshot={s} pending={pending} save={save} action={action}/>:id==='audio'?<AudioSettings snapshot={s} pending={pending} action={action}/>:<ClockSettings snapshot={s} pending={pending} save={save} action={action}/>}</div>}
      </Panel>
    })}</div>
    <Panel title="Swipe navigation" description="Your enabled modules appear in this order."><div className="module-order">{enabled.map((id,index)=><div key={id}>{index>0&&<ChevronRight size={14}/>}<span>{index+1}<strong>{moduleNames[id]}</strong></span></div>)}</div><SettingRow title="Swipe to switch" description="Swipe left or right on the physical screen."><Switch checked={s.settings.device.swipeEnabled} disabled={pending} aria-label="Swipe to switch modules" onCheckedChange={value=>void save({device:{swipeEnabled:value}})}/></SettingRow></Panel>
  </>
}

function ClockSettings({snapshot:s,pending,save}:PageProps) {
  const config = s.settings.modules.clock
  return <div className="clock-settings">
    <SelectField label="Time format" value={config.hourFormat} disabled={pending} onChange={hourFormat=>void save({modules:{clock:{hourFormat}}})}>
      <option value="12">12-hour (5:20)</option><option value="24">24-hour (17:20)</option>
    </SelectField>
    <SettingRow title="Show weekday" description="Place the day below the time.">
      <Switch aria-label="Show weekday" checked={config.showWeekday} disabled={pending} onCheckedChange={showWeekday=>void save({modules:{clock:{showWeekday}}})}/>
    </SettingRow>
    <SettingRow title="Blink separator" description="Blink the colon once per second.">
      <Switch aria-label="Blink separator" checked={config.blinkSeparator} disabled={pending} onCheckedChange={blinkSeparator=>void save({modules:{clock:{blinkSeparator}}})}/>
    </SettingRow>
    <p className="privacy-note">Synced with your computer's local time while the bridge is running.</p>
  </div>
}

function UsageSettings({snapshot:s,pending,save,action}:PageProps) {
  const source=s.modules.usage,config=s.settings.modules.usage
  return <><div className="module-fields"><SelectField label="Provider on device" value={config.provider} onChange={provider=>void save({modules:{usage:{provider}}})} disabled={pending}><option value="auto">All configured providers</option>{config.provider!=='auto'&&!source.providers.some(p=>p.id===config.provider)&&<option value={config.provider}>{config.provider} (saved)</option>}{source.providers.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</SelectField><SelectField label="Refresh interval" value={config.refreshSeconds} onChange={value=>void save({modules:{usage:{refreshSeconds:Number(value)}}})} disabled={pending}>{[30,60,120,300].map(n=><option value={n} key={n}>{n<60?`${n} seconds`:`${n/60} ${n===60?'minute':'minutes'}`}</option>)}</SelectField></div>
    {source.error&&<p className="source-message" role="status">{source.error}</p>}
    {s.module==='usage'&&(s.display.dashboard?.pageCount??1)>1&&<div className="usage-paging"><span>Device cards <small>{(s.display.dashboard?.pageIndex??0)+1} of {s.display.dashboard?.pageCount}</small></span><div><Button variant="ghost" size="icon-sm" aria-label="Previous usage cards" disabled={pending||source.status!=='ready'} onClick={()=>void action('usage/page',{direction:-1})}><ArrowUp size={14}/></Button><Button variant="ghost" size="icon-sm" aria-label="Next usage cards" disabled={pending||source.status!=='ready'} onClick={()=>void action('usage/page',{direction:1})}><ArrowDown size={14}/></Button></div></div>}
    {source.providers.map(provider=><div className="usage-readout" key={provider.id}><div className="readout-heading"><strong>{provider.label}</strong><span>{provider.plan||'Usage remaining'}</span></div>{provider.windows.map(window=>{
      const remaining=Math.max(0,Math.min(100,100-window.usedPercent))
      const label=window.label.startsWith(`${provider.label} `)?window.label.slice(provider.label.length+1):window.label
      return <div className="usage-window" key={window.id} data-level={remaining<=10?'low':remaining<=25?'caution':'normal'}><div><strong><span className="pixel-number">{Math.round(remaining)}%</span> <small>left</small></strong><span className="usage-window-label" title={window.label}>{label}</span></div><div className="usage-track" role="meter" aria-label={`${window.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}><span style={{width:`${remaining}%`}}/></div><p>{resetTime(window.resetAt)}</p></div>
    })}{!provider.windows.length&&<p className="source-hint">No usage windows available.</p>}</div>)}
    {!config.enabled&&<p className="source-hint">CodexBar is detected automatically. Enable this module to read your configured providers.</p>}
    <div className="module-detail-footer"><span>{relativeTime(source.updatedAt)}</span><Button variant="ghost" disabled={pending||source.refreshing||source.status==='loading'} onClick={()=>void action('modules/refresh',{id:'usage'},'CodexBar checked')}><RefreshCw size={13}/>{source.refreshing?'Checking':'Refresh'}</Button></div><p className="privacy-note">Uses your existing CodexBar connection. Provider accounts stay in CodexBar.</p>
  </>
}
function HeySettings({snapshot:s,pending,save,action}:PageProps) {
  const source = s.modules.hey, config = s.settings.modules.hey
  const ready = config.enabled && source.status === 'ready' && source.selectedBox === config.box && Array.isArray(source.items)
  const items = ready ? source.items ?? [] : []
  const pageCount = s.display.dashboard?.pageCount ?? 1
  return <>
    <div className="module-fields">
      <SelectField label="Mailbox on device" value={config.box} onChange={box=>void save({modules:{hey:{box}}})} disabled={pending}>
        {Object.entries(boxes).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </SelectField>
      <SelectField label="Update spacing" value={config.refreshSeconds} onChange={value=>void save({modules:{hey:{refreshSeconds:Number(value)}}})} disabled={pending}>
        {[30,60,120,300].map(n=><option value={n} key={n}>{n<60?`${n} seconds`:`${n/60} ${n===60?'minute':'minutes'}`}</option>)}
      </SelectField>
    </div>
    {source.error && <p className="source-message" role="status">{source.error}</p>}
    {ready && <section className="hey-mail-list" aria-label={`${boxes[config.box as keyof typeof boxes]} messages`}>
      <div className="readout-heading"><strong>{boxes[config.box as keyof typeof boxes]}</strong><span>{config.box==='screener'?'Waiting to be screened':'Recent mail'}</span></div>
      {items.length ? <ul>{items.map((item,index)=><li key={`${item.id}-${index}`}>
        <strong dir="auto">{item.sender}</strong><p dir="auto">{item.subject}</p>
      </li>)}</ul> : <p className="hey-mail-empty">{config.box==='imbox'?'You are all caught up.':'Nothing here yet.'}</p>}
    </section>}
    {ready && s.module==='hey' && pageCount>1 && <div className="usage-paging">
      <span>On your device <small>{(s.display.dashboard?.pageIndex??0)+1} of {pageCount}</small></span>
      <div>
        <Button variant="ghost" size="icon-sm" aria-label="Previous mail" disabled={pending} onClick={()=>void action('hey/page',{direction:-1})}><ArrowUp size={14}/></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next mail" disabled={pending} onClick={()=>void action('hey/page',{direction:1})}><ArrowDown size={14}/></Button>
      </div>
    </div>}
    <p className="source-hint">{!config.enabled ? 'Enable this module to see mail using your existing HEY sign-in.' : ready && items.length ? `${items.length>3?'Swipe up or down on the device to browse.':'Your recent mail, ready at a glance.'}${source.hasMore?' Recent mail only; open HEY for older messages.':''}` : config.box==='screener'?'HEY checks for new senders at the selected interval.':'HEY watches for mailbox changes.'}</p>
    <div className="module-detail-footer"><span>{relativeTime(source.updatedAt)}</span><Button variant="ghost" disabled={pending||source.refreshing||source.status==='loading'} onClick={()=>void action('modules/refresh',{id:'hey'},'HEY checked')}><RefreshCw size={13}/>{source.refreshing?'Checking':'Refresh'}</Button></div>
    <p className="privacy-note">Shows senders and subjects without marking messages as read.</p>
  </>
}

function DeviceSettings({snapshot:s,pending,save,action}:PageProps) {
  const settings=s.settings
  const exportSettings=()=>{const blob=new Blob([JSON.stringify(settings,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='companion-settings.json';a.click();URL.revokeObjectURL(url);toast.success('Settings exported')}
  return <>
    <Panel className="hardware-card"><div className="hardware-summary"><span className="hardware-icon"><Cpu size={30}/></span><div><Eyebrow>Your companion</Eyebrow><h2>{s.device.profile?.name || 'Waveshare AMOLED'}</h2><p>{s.device.profile ? `${s.device.profile.display.width} x ${s.device.profile.display.height} ${s.device.profile.display.shape} display - ${s.device.profile.status}` : 'ESP32-S3 / 1.75-inch round touch display'}</p><div className="hardware-status"><StatusDot state={s.device.status==='connected'?'connected':'idle'}/>{s.device.status==='connected'?'Connected over USB':s.device.status==='disabled'?'USB connection not configured':'Waiting for your device'}</div></div></div><SerialConnection snapshot={s} pending={pending} action={action}/></Panel>
    <Panel title="Device appearance" description="Colours for the companion, independent of the studio."><DeviceAppearance snapshot={s} disabled={pending} save={save}/></Panel>
    <Panel title="Display" description="Small adjustments. A more comfortable companion."><SettingRow title="Physical display rotation" description="Fine-tune the device angle. The playground stays upright."><PhysicalRotation value={settings.device.rotation??0} disabled={pending} onSave={rotation=>save({device:{rotation}})}/></SettingRow><SettingRow title="Text spacing" description="The gap between status and session name."><SelectField compact label="Text spacing" value={settings.device.textGap} disabled={pending} onChange={value=>void save({device:{textGap:Number(value)}})}><option value={4}>Close</option><option value={8}>Balanced</option><option value={16}>Wide</option></SelectField></SettingRow><SettingRow title="Follow your mouse" description="The face eases towards your cursor. Available on macOS."><Switch aria-label="Follow your mouse" checked={settings.device.followMouse} disabled={pending||!s.pointer.supported} onCheckedChange={value=>void save({device:{followMouse:value}})}/></SettingRow>{settings.device.followMouse&&<SettingRow title="Mouse update interval" description="Smooth motion between each sampled position."><SelectField compact label="Mouse update interval" value={settings.device.mouseInterval} disabled={pending} onChange={value=>void save({device:{mouseInterval:Number(value)}})}>{[100,250,500,1000].map(n=><option key={n} value={n}>{n===1000?'1 second':`${n} ms`}</option>)}</SelectField></SettingRow>}{s.pointer.error&&<p className="source-message">{s.pointer.error}</p>}<SettingRow title="Show module selector" description="Navigation buttons and page dots. Swiping works while hidden."><Switch aria-label="Show module selector" checked={settings.device.showModuleNavigation??false} disabled={pending} onCheckedChange={showModuleNavigation=>void save({device:{showModuleNavigation}})}/></SettingRow><SettingRow title="Show card backgrounds" description="Subtle panels behind usage and HEY cards. Off uses the screen colour."><Switch aria-label="Show card backgrounds" checked={settings.device.showCardBackgrounds??false} disabled={pending} onCheckedChange={showCardBackgrounds=>void save({device:{showCardBackgrounds}})}/></SettingRow><SettingRow title="Typography" description="Geist on the screen and throughout the studio."><span className="font-specimen">Aa <small>Geist</small></span></SettingRow></Panel>
    <Panel title="Studio preferences" description="Make this workspace your own."><SettingRow title="Appearance" description="Choose a light, dark or system theme."><SelectField compact label="Appearance" value={settings.appearance.theme} disabled={pending} onChange={theme=>void save({appearance:{theme}})}><option value="light">Light</option><option value="dark">Dark</option><option value="system">System</option></SelectField></SettingRow><SettingRow title="Reading direction" description="English starts left to right. Change it any time."><SelectField compact label="Reading direction" value={settings.appearance.direction} disabled={pending} onChange={direction=>void save({appearance:{direction}})}><option value="ltr">Left to right</option><option value="rtl">Right to left</option></SelectField></SettingRow><SettingRow title="Reduce preview motion" description="Still previews and quieter interface transitions."><Switch aria-label="Reduce preview motion" checked={settings.appearance.reducedMotion} disabled={pending} onCheckedChange={reducedMotion=>void save({appearance:{reducedMotion}})}/></SettingRow></Panel>
    <Panel title="Your configuration" description="Mappings, module order and preferences are saved on this computer."><div className="export-row"><p>Take your settings with you.</p><Button variant="outline" onClick={exportSettings}><Download size={14}/>Export settings</Button></div></Panel>
  </>
}
