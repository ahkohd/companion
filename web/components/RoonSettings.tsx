import { useEffect, useState } from 'react'
import { Heart, Monitor } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import type { PlayerId, StudioSnapshot } from '../lib/studio'
import './roon.css'
import { RoonIcon } from './RoonIcon'
import { PlayerIcon } from './PlayerIcon'

const players: {id:PlayerId;name:string;description:string}[] = [
  {id:'roon',name:'Roon',description:'Your selected listening zone.'},
  {id:'spotify',name:'Spotify',description:'Playback in the Spotify app on this Mac.'},
  {id:'appleMusic',name:'Apple Music',description:'Playback in the Music app on this Mac.'},
  {id:'system',name:'macOS Now Playing',description:'The active media player on your Mac.'},
]
const statusLabel = (status?:string) => status==='ready'?'Connected':status==='loading'?'Connecting':status==='auth-required'?'Permission needed':status==='disabled'?'Off':status==='error'?'Connection error':status==='unsupported'||status==='unavailable'?'Unavailable':'Not playing'

export default function RoonSettings({snapshot:s,pending,save,action}:{snapshot:StudioSnapshot;pending:boolean;save:(patch:unknown,message?:string)=>Promise<boolean>;action:(path:string,payload:unknown,message?:string)=>Promise<boolean>}) {
  const config=s.settings.modules.roon, source=s.modules.roon, roon=source.roon||source
  const enabled=config.players||{roon:true,spotify:false,appleMusic:false,system:false}
  const [host,setHost]=useState(config.host)
  useEffect(()=>setHost(config.host),[config.host])
  const controlSize=s.settings.design.roon.controlSize
  const controlStyle={width:controlSize,height:controlSize}
  const ready=config.enabled&&source?.status==='ready'
  const player=source.player||'roon', playerName=source.playerName||'Roon'
  const control=(actionName:string)=>void action('roon/control',{action:actionName,player})
  return <div className="roon-settings">
    <div className="music-player-list">
      {players.map(item=>{const state=source.players?.find(value=>value.id===item.id);return <div className="music-player-row" key={item.id}>
        <span className="music-player-icon">{item.id==='system'?<Monitor size={20}/>:<PlayerIcon player={item.id}/>}</span>
        <div className="music-player-copy"><strong>{item.name}</strong><p>{item.description}</p>{enabled[item.id]&&config.enabled&&<small>{statusLabel(state?.status)}</small>}</div>
        <Switch checked={enabled[item.id]} disabled={pending||(enabled[item.id]&&Object.values(enabled).filter(Boolean).length===1)} aria-label={`Enable ${item.name}`} onCheckedChange={value=>void save({modules:{roon:{players:{[item.id]:value}}}})}/>
      </div>})}
    </div>
    <p className="music-navigation-note">Swipe up or down to switch players. Swipe left or right to switch modules. macOS may show the same track as Spotify or Apple Music.</p>
    <div className="music-player-tabs" role="group" aria-label="Preview music player">{players.filter(item=>enabled[item.id]).map(item=><Button key={item.id} size="sm" variant={player===item.id?'secondary':'ghost'} aria-pressed={player===item.id} disabled={pending||!config.enabled} onClick={()=>void action('roon/player',{id:item.id})}>{item.name}</Button>)}</div>
    {ready&&<div className="roon-now-playing">
      <div className="roon-art">{source.artId&&<img src={`/api/roon/art/${source.artId}`} alt="Album artwork"/>}{player!=='system'&&<span className="music-art-badge"><PlayerIcon player={player} size={28}/></span>}{source.canLike&&<button className="music-art-like" aria-label={source.liked?'Remove from favourites':'Add to favourites'} aria-pressed={!!source.liked} disabled={pending} onClick={()=>control('like')}><Heart size={18} fill={source.liked?'currentColor':'none'}/></button>}</div>
      <div className="roon-track"><span>{playerName} / {source.playing?'Now playing':'Paused'}</span><strong>{source.track||'Nothing playing'}</strong><p>{source.artist}</p><div className="roon-transport">
        <Button variant="ghost" size="icon-sm" style={controlStyle} aria-label={`Previous ${playerName} track`} disabled={pending||!source.canPrevious} onClick={()=>control('previous')}><RoonIcon name="previous" size={controlSize*24/44}/></Button>
        <Button variant="ghost" size="icon-sm" style={controlStyle} aria-label={`${source.playing?'Pause':'Play'} ${playerName}`} disabled={pending} onClick={()=>control('playpause')}>{source.playing?<svg viewBox="0 0 44 44" width={controlSize} height={controlSize} style={{width:controlSize,height:controlSize}} fill="currentColor" aria-hidden="true"><rect x="12" y="8" width="6" height="28"/><rect x="26" y="8" width="6" height="28"/></svg>:<RoonIcon name="play" size={controlSize*34/44}/>}</Button>
        <Button variant="ghost" size="icon-sm" style={controlStyle} aria-label={`Next ${playerName} track`} disabled={pending||!source.canNext} onClick={()=>control('next')}><RoonIcon name="next" size={controlSize*24/44}/></Button>
        
      </div></div>
    </div>}
    {source.error&&<p className="source-message" role="status">{source.error}</p>}
    {enabled.roon&&<>
      <div className="roon-setup">
        <div><h3>Roon connection</h3><p>{roon.status==='ready'?roon.coreName:'Enable Companion in Roon Settings > Extensions, then choose your listening zone.'}</p></div>
        <label className="roon-zone">Listening zone<select aria-label="Roon listening zone" value={config.zoneId} disabled={pending||!config.enabled} onChange={e=>void save({modules:{roon:{zoneId:e.target.value}}})}><option value="">Automatic{roon.zoneId?` (${roon.zones?.find(z=>z.id===roon.zoneId)?.name||'current zone'})`:''}</option>{config.zoneId&&!roon.zones?.some(z=>z.id===config.zoneId)&&<option value={config.zoneId}>Saved zone (offline)</option>}{roon.zones?.map(zone=><option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
        {player!=='roon'&&roon.error&&<p className="source-message" role="status">{roon.error}</p>}
      </div>
      <details className="roon-advanced"><summary>Roon server connection</summary><p>Leave blank to find Roon on your network, or enter its local address.</p><form onSubmit={e=>{e.preventDefault();void save({modules:{roon:{host:host.trim()}}},'Roon server saved')}}><Input aria-label="Roon server address" placeholder="Automatic discovery" value={host} onChange={e=>setHost(e.target.value)} disabled={pending}/><Button type="submit" variant="outline" disabled={pending||host.trim()===config.host}>Save</Button></form></details>
    </>}
    <p className="privacy-note">Playback controls affect the player shown. Switching players does not interrupt playback.</p>
  </div>
}
