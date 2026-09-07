import { useEffect, useState } from 'react'
import { Music2, Pause } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import type { StudioSnapshot } from '../lib/studio'
import './roon.css'
import { RoonIcon } from './RoonIcon'

export default function RoonSettings({snapshot:s,pending,save,action}:{snapshot:StudioSnapshot;pending:boolean;save:(patch:unknown,message?:string)=>Promise<boolean>;action:(path:string,payload:unknown,message?:string)=>Promise<boolean>}) {
  const config=s.settings.modules.roon, source=s.modules.roon
  const [host,setHost]=useState(config.host)
  useEffect(()=>setHost(config.host),[config.host])
  const controlSize=s.settings.design.roon.controlSize
  const controlStyle={width:controlSize,height:controlSize}
  const ready=config.enabled&&source?.status==='ready'
  return <div className="roon-settings">
    <div className="roon-setup">
      <div><h3>{ready?'Connected to your music':'Connect Roon'}</h3><p>{ready?source.coreName:'Enable Companion in Roon Settings > Extensions, then choose your listening zone.'}</p></div>
      <label className="roon-zone">Listening zone<select aria-label="Roon listening zone" value={config.zoneId} disabled={pending||!config.enabled} onChange={e=>void save({modules:{roon:{zoneId:e.target.value}}})}><option value="">Automatic{source?.zoneId?` (${source.zones.find(z=>z.id===source.zoneId)?.name||'current zone'})`:''}</option>{config.zoneId&&!source?.zones?.some(z=>z.id===config.zoneId)&&<option value={config.zoneId}>Saved zone (offline)</option>}{source?.zones?.map(zone=><option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
      {source?.error&&<p className="source-message" role="status">{source.error}</p>}
    </div>
    {ready&&<div className="roon-now-playing">
      <div className="roon-art">{source.artId?<img src={`/api/roon/art/${source.artId}`} alt="Album artwork"/>:<Music2 size={32}/>}</div>
      <div className="roon-track"><span>{source.playing?'Now playing':'Paused'}</span><strong>{source.track||'Nothing playing'}</strong><p>{source.artist}</p><div className="roon-transport">
        <Button variant="ghost" size="icon-sm" style={controlStyle} aria-label="Previous Roon track" disabled={pending||!source.canPrevious} onClick={()=>void action('roon/control',{action:'previous'})}><RoonIcon name="previous" size={controlSize*24/44}/></Button>
        <Button variant="ghost" size="icon-sm" style={controlStyle} aria-label={source.playing?'Pause Roon':'Play Roon'} disabled={pending||!source.zoneId} onClick={()=>void action('roon/control',{action:'playpause'})}>{source.playing?<Pause style={{width:controlSize*28/44,height:controlSize*28/44}}/>:<RoonIcon name="play" size={controlSize*34/44}/>}</Button>
        <Button variant="ghost" size="icon-sm" style={controlStyle} aria-label="Next Roon track" disabled={pending||!source.canNext} onClick={()=>void action('roon/control',{action:'next'})}><RoonIcon name="next" size={controlSize*24/44}/></Button>
      </div></div>
    </div>}
    <details className="roon-advanced"><summary>Server connection</summary><p>Leave blank to find Roon on your network, or enter its local address.</p><form onSubmit={e=>{e.preventDefault();void save({modules:{roon:{host:host.trim()}}},'Roon server saved')}}><Input aria-label="Roon server address" placeholder="Automatic discovery" value={host} onChange={e=>setHost(e.target.value)} disabled={pending}/><Button type="submit" variant="outline" disabled={pending||host.trim()===config.host}>Save</Button></form></details>
    <p className="privacy-note">Connects locally to Roon. Playback controls affect the selected zone.</p>
  </div>
}
