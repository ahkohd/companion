import type {PlayerId} from '../lib/studio'

export function PlayerIcon({player,size=20}:{player:PlayerId;size?:number}) {
  if(player==='system')return null
  if(player==='roon')return <img src="/icons/players/roon.png" width={size} height={size} alt="" aria-hidden="true" draggable={false}/>
  if(player==='appleMusic')return <img src="/icons/players/apple-music.png" width={size} height={size} alt="" aria-hidden="true" draggable={false}/>
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1ed760"/><path d="M5.5 9c4.5-1.4 8.9-1 13 1.2M6.3 12.5c3.6-1.1 7.6-.8 10.8 1M7.2 15.7c3-.8 5.9-.6 8.7.9" stroke="#101010" strokeWidth="1.7" strokeLinecap="round"/></svg>
}
