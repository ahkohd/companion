import {useEffect,useState} from 'react'
import {Check,Monitor,Moon,RotateCcw,Sun} from 'lucide-react'
import {devicePaletteDefaults} from '../lib/device-appearance'
import {Button} from './ui/button'
import {colorHex} from '../lib/design'
import type {DevicePalette,DeviceTheme,StudioSnapshot} from '../lib/studio'
import './device-appearance.css'

const tokens: {key:keyof DevicePalette;label:string;detail:string}[] = [
 {key:'background',label:'Screen',detail:'The canvas behind every module'},
 {key:'foreground',label:'Primary text',detail:'Headings, numbers and the face'},
 {key:'muted',label:'Secondary text',detail:'Supporting text and reset times'},
 {key:'surface',label:'Card surface',detail:'Optional card backgrounds'},
 {key:'track',label:'Progress track',detail:'The unfilled part of a meter'},
 {key:'accent',label:'Accent',detail:'Progress and highlighted details'},
 {key:'success',label:'Success',detail:'Positive status accents'},
 {key:'warning',label:'Warning',detail:'Low balances and attention'},
 {key:'danger',label:'Critical',detail:'Nearly exhausted balances'},
]

function ColourField({value,label,onChange,disabled}:{value:number;label:string;onChange:(n:number)=>void;disabled:boolean}) {
 const [text,setText]=useState(colorHex(value))
 useEffect(()=>setText(colorHex(value)),[value])
 return <div className="device-colour-input"><input type="color" aria-label={`${label} colour`} value={colorHex(value)} disabled={disabled} onChange={e=>onChange(parseInt(e.target.value.slice(1),16))}/><input aria-label={`${label} hex value`} value={text} required pattern="#[0-9a-fA-F]{6}" title="Use a six-digit hex colour, such as #171717" spellCheck={false} maxLength={7} disabled={disabled} onChange={e=>{setText(e.target.value);if(/^#[0-9a-fA-F]{6}$/.test(e.target.value))onChange(parseInt(e.target.value.slice(1),16))}}/></div>
}

export default function DeviceAppearance({snapshot:s,disabled,save}:{snapshot:StudioSnapshot;disabled:boolean;save:(patch:unknown,message?:string)=>Promise<boolean>}) {
 const config=s.settings.deviceAppearance || {mode:'dark',palettes:devicePaletteDefaults}
 const [editing,setEditing]=useState<DeviceTheme>(s.deviceAppearance?.resolved || (config.mode==='light'?'light':'dark'))
 const [draft,setDraft]=useState<DevicePalette>({...config.palettes[editing]})
 const [dirty,setDirty]=useState(false)
 useEffect(()=>{if(!dirty)setDraft({...config.palettes[editing]})},[config.palettes,editing,dirty])
 const choose=(mode:DeviceTheme)=>{setEditing(mode);setDirty(false);setDraft({...config.palettes[mode]})}
 const change=(key:keyof DevicePalette,value:number)=>{setDraft(current=>({...current,[key]:value}));setDirty(true)}
 const active=s.deviceAppearance?.resolved || (config.mode==='light'?'light':'dark')
 return <div className="device-appearance" id="device-appearance">
  <div className="device-theme-modes" role="group" aria-label="Device colour mode">{([{id:'light',label:'Light',Icon:Sun},{id:'dark',label:'Dark',Icon:Moon},{id:'system',label:'System',Icon:Monitor}] as const).map(({id,label,Icon})=><button key={id} type="button" disabled={disabled} aria-pressed={config.mode===id} onClick={()=>void save({deviceAppearance:{mode:id}},`Device uses ${label.toLowerCase()} colours`)}><Icon size={18}/><span>{label}</span>{config.mode===id&&<Check size={13}/>}</button>)}</div>
  <p className="device-appearance-caption">{config.mode==='system'?`Following this computer · ${active} colours`:`The device uses ${active} colours`}. Studio appearance is set separately.</p>
  <div className="device-palette-heading"><div><h3>Colour palettes</h3><p>Each mode keeps its own colours.</p></div><div className="device-palette-tabs" role="group" aria-label="Palette to edit">{(['light','dark'] as const).map(mode=><button key={mode} type="button" aria-pressed={editing===mode} disabled={disabled||dirty&&editing!==mode} onClick={()=>choose(mode)}>{mode==='light'?<Sun size={13}/>:<Moon size={13}/>} {mode==='light'?'Light':'Dark'}</button>)}</div></div>
  <form onSubmit={async e=>{e.preventDefault();if(await save({deviceAppearance:{palettes:{[editing]:draft}}},`${editing==='light'?'Light':'Dark'} device palette saved`))setDirty(false)}}>
   <div className="device-colour-grid">{tokens.map(({key,label,detail})=><div className="device-colour-row" key={`${editing}-${key}`}><div><label>{label}</label><p>{detail}</p></div><ColourField value={draft[key]} label={`${editing} ${label.toLowerCase()}`} disabled={disabled} onChange={value=>change(key,value)}/><button type="button" className="device-colour-reset" title={`Reset ${label.toLowerCase()}`} aria-label={`Reset ${editing} ${label.toLowerCase()}`} disabled={disabled||draft[key]===devicePaletteDefaults[editing][key]} onClick={()=>change(key,devicePaletteDefaults[editing][key])}><RotateCcw size={13}/></button></div>)}</div>
   <div className="device-palette-footer"><span role="status">{dirty?'Unsaved palette changes':editing===active?'Active on your device':'Ready when you switch modes'}</span><div>{dirty&&<Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={()=>{setDraft({...config.palettes[editing]});setDirty(false)}}>Discard</Button>}<Button type="submit" size="sm" disabled={disabled||!dirty}>Save palette</Button></div></div>
  </form>
 </div>
}
