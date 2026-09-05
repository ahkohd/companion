import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import defaults from '../../shared/studio-defaults.json'
import catalog from '../../shared/grok-catalog.json'

export type ModuleId = 'face' | 'usage' | 'hey' | 'clock' | 'roon'
export type DeviceTheme = 'dark' | 'light'
export type DevicePalette = Record<'background'|'foreground'|'muted'|'surface'|'track'|'accent'|'success'|'warning'|'danger',number>
export interface DeviceAppearanceSettings {mode:DeviceTheme|'system';palettes:Record<DeviceTheme,DevicePalette>}
export interface OpenCardRequest { module: 'hey' | 'usage'; index: number; token: string }
export type Status = 'working' | 'blocked' | 'done' | 'idle' | 'unknown' | 'disconnected'
export type Settings = typeof defaults
export interface UsageWindow { id: string; label: string; usedPercent: number; resetAt: number | null }
export interface Source { status: string; refreshing?: boolean; installed: boolean | null; version: string | null; updatedAt: number | null; error: string | null }
export interface UsageSource extends Source { providers: {id: string; label: string; plan?: string; windows: UsageWindow[]}[] }
export interface HeyItem { id: string; sender: string; subject: string }
export interface HeySource extends Source { items: HeyItem[]; hasMore: boolean; selectedBox: string }
export interface RoonSource extends Source { coreName?: string; zones: {id:string;name:string;state:string}[]; zoneId:string; track:string; artist:string; playing:boolean; canPrevious:boolean; canNext:boolean; artId:string|null; artworkLoading?:boolean }
export interface StudioSettings extends Omit<Settings, 'mappings'|'deviceAppearance'> { mappings: Record<Status, string | null>;deviceAppearance:DeviceAppearanceSettings }
export interface StudioSnapshot {
  seq: number; module: ModuleId; settings: StudioSettings; settingsRevision: number;
  deviceAppearance?: {mode:DeviceTheme|'system';resolved:DeviceTheme;system:DeviceTheme;palette:DevicePalette;design:Record<ModuleId,Record<string,number>>};
  connected: boolean; error: string | null; selected: string; expression: string | null;
  agents: {id: string; name: string; kind: string; project: string; state: string}[];
  display: {state: string; label: string; name: string; nameShimmer?: boolean; animation?: string | null; expression?: string; counts?: Record<string,number>; dashboard?: {status: string; refreshing?: boolean; title: string; detail: string; track?:string;artist?:string;artId?:string;expanded?:boolean;playing?:boolean;canPrevious?:boolean;canNext?:boolean; time?: string; weekday?: string; blinkSeparator?: boolean; pageIndex?: number; pageCount?: number; openToken?: string; primary?: {provider?: string; label: string; remaining: number | null; reset: string; openable?: boolean}; secondary?: {provider?: string; label: string; remaining: number | null; reset: string; openable?: boolean}; items?: (Pick<HeyItem, 'sender' | 'subject'> & {openable?: boolean})[]}};
  changedAt: number; animationMs: number; ageMs: number; updatedAt: number | null; layout: {textGap: number};
  device: {fontError?: boolean; status: string; port: string | null; error: string | null; lastAck?: number; renderedModule?: string};
  pointer: {supported: boolean; enabled: boolean; intervalMs: number; status: string; error: string | null; x: number; y: number};
  modules: {usage: UsageSource; hey: HeySource; roon: RoonSource};
}
export const moduleNames: Record<ModuleId,string> = {face: 'Herdr Face', usage: 'CodexBar', hey: 'HEY', clock: 'Clock', roon: 'Roon'}
export const statusNames: Record<string,string> = {working:'Working',blocked:'Needs input',done:'Ready',idle:'Idle',unknown:'Unknown',disconnected:'Disconnected',sleep:'Sleeping'}
export const statusDescriptions: Record<Status,string> = {working:'An agent is working on a task.',blocked:'An agent needs your input to continue.',done:'Work is ready for you to review.',idle:'Your agents are taking a moment.',unknown:'An agent has no reported status.',disconnected:'The connection to Herdr is unavailable.'}
export const boxes = {imbox:'Imbox',feed:'The Feed',paperTrail:'Paper Trail',replyLater:'Reply Later',screener:'Screener'}
export const originals = ['working','blocked','done','idle','sleep'].map(id => ({id,label:statusNames[id],group:'Originals',source:''}))
export const animations = [...originals,...catalog]
export const animationName = (id: string | null) => id ? animations.find(a => a.id === id)?.label ?? id : 'Original animation'
export function relativeTime(at: number | null | undefined) {
  if (!at) return 'Not refreshed yet'
  const seconds = Math.max(0,Math.floor((Date.now()-at)/1000))
  return seconds < 60 ? 'Updated just now' : seconds < 3600 ? `Updated ${Math.floor(seconds/60)}m ago` : `Updated ${Math.floor(seconds/3600)}h ago`
}
export function resetTime(at: number | null) {
  if (!at) return 'No reset time available'
  const minutes = Math.max(0, Math.ceil((at-Date.now())/60000))
  return minutes < 1 ? 'Resetting soon' : minutes < 60 ? `Resets in ${minutes}m` : minutes < 1440 ? `Resets in ${Math.floor(minutes/60)}h ${minutes%60}m` : `Resets in ${Math.floor(minutes/1440)}d ${Math.floor(minutes%1440/60)}h`
}
export function useStudio() {
  const [snapshot,setSnapshot] = useState<StudioSnapshot|null>(null)
  const [online,setOnline] = useState(false)
  const [pending,setPending] = useState(false)
  const busy = useRef(false)
  const refreshing = useRef(new Set<string>())
  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onmessage = event => { try { const value = JSON.parse(event.data); if(value.settings) { setSnapshot(value); setOnline(true) } } catch { /* Keep the last complete snapshot. */ } }
    events.onerror = () => setOnline(false)
    return () => events.close()
  },[])
  const action = useCallback(async (path: string, payload: unknown, message?: string) => {
    const refresh = path === 'modules/refresh'
    const refreshId = JSON.stringify(payload)
    if (refresh ? refreshing.current.has(refreshId) : busy.current) return false
    if (refresh) refreshing.current.add(refreshId)
    else { busy.current = true; setPending(true) }
    try {
      const response = await fetch(`/api/${path}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      const result = await response.json()
      if(!response.ok) throw new Error(result.error || 'The change could not be saved.')
      // SSE is authoritative; a slower POST response must not replace a newer event.
      if(message) toast.success(message)
      return true
    } catch(error) { toast.error(error instanceof Error ? error.message : 'Could not reach the bridge.'); return false }
    finally { if (refresh) refreshing.current.delete(refreshId); else { busy.current = false; setPending(false) } }
  },[])
  const save = useCallback((patch: unknown,message = 'Settings saved') => action('settings',patch,message),[action])
  return {snapshot,online,pending,action,save}
}
