import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type defaults from '../../shared/studio-defaults.json'
import type { AttentionState } from '../components/Attention'

export type ModuleId = 'face' | 'usage' | 'hey' | 'clock' | 'roon' | 'audio' | 'speedDial'

export type DeviceTheme = 'dark' | 'light'

export type DevicePalette = Record<
  | 'background'
  | 'foreground'
  | 'muted'
  | 'surface'
  | 'track'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger',
  number
>

export interface DeviceAppearanceSettings {
  mode: DeviceTheme | 'system'
  palettes: Record<DeviceTheme, DevicePalette>
}

export interface OpenCardRequest {
  module: 'hey' | 'usage'
  index: number
  token: string
}

export interface SerialPortChoice {
  path: string
  manufacturer?: string | null
  serialNumber?: string | null
  vendorId?: string | null
  productId?: string | null
  compatible: boolean
}

export interface SerialConnectionState {
  mode: 'auto' | 'manual' | 'off'
  path: string | null
  serialNumber: string | null
  ports: SerialPortChoice[]
  scanning: boolean
  error: string | null
}

export type Status = 'working' | 'blocked' | 'done' | 'idle' | 'unknown' | 'disconnected'

export type Settings = typeof defaults

export interface UsageWindow {
  id: string
  label: string
  usedPercent: number
  resetAt: number | null
}

export interface Source {
  status: string
  refreshing?: boolean
  installed: boolean | null
  version: string | null
  updatedAt: number | null
  error: string | null
}

export interface UsageSource extends Source {
  providers: { id: string; label: string; plan?: string; windows: UsageWindow[] }[]
}

export interface HeyItem {
  id: string
  sender: string
  subject: string
}

export interface HeySource extends Source {
  items: HeyItem[]
  hasMore: boolean
  selectedBox: string
}

export type PlayerId = 'roon' | 'spotify' | 'appleMusic' | 'system'

export type AudioScope = 'output' | 'input'

export interface AudioControlRequest {
  scope: AudioScope
  deviceId: number
  action: 'volume' | 'mute' | 'device'
  value: number | boolean
}

export interface AudioViewRequest {
  open: boolean
  scope: AudioScope
  deviceId: number
}

export interface AudioPickerDevice {
  id: number
  name: string
  active: boolean
}

export interface AudioSource {
  pickerOpen: boolean
  devices: AudioPickerDevice[]
  nextDeviceId: number
  deviceCount: number
  status: string
  error: string | null
  scope: AudioScope
  deviceId: number
  deviceName: string
  volume: number | null
  muted: boolean | null
  canVolume: boolean
  canMute: boolean
  inputs: { id: number; name: string }[]
  outputs: { id: number; name: string }[]
}

export interface PlayerSummary {
  id: PlayerId
  name: string
  status: string
}

export interface RoonSource extends Source {
  player?: PlayerId
  playerName?: string
  players?: PlayerSummary[]
  pageIndex?: number
  pageCount?: number
  canLike?: boolean
  liked?: boolean
  roon?: RoonSource
  coreName?: string
  zones: { id: string; name: string; state: string }[]
  zoneId: string
  track: string
  artist: string
  playing: boolean
  canPrevious: boolean
  canNext: boolean
  artId: string | null
  artworkLoading?: boolean
}

export type SpeedDialActionType = 'shell' | 'app' | 'url' | 'file' | 'shortcut'

export interface SpeedDialAction {
  type: SpeedDialActionType
  value: string
}

export interface SpeedDialIcon {
  kind: 'emoji' | 'builtin' | 'image'
  value: string
  assetId: string
}

export interface SpeedDialButton {
  id: string
  label: string
  enabled: boolean
  color: number | null
  icon: SpeedDialIcon
  actions: SpeedDialAction[]
}

export interface SpeedDialSettings {
  enabled: boolean
  layout: 'grid' | 'list'
  gridSize: 0 | 4 | 6
  listRows: 3 | 4
  showLabels: boolean
  buttons: SpeedDialButton[]
}

export interface SpeedDialResult {
  status: 'running' | 'success' | 'error'
  error?: string
  output?: string
  finishedAt?: number
}

export interface SpeedDialSource {
  dashboard?: NonNullable<StudioSnapshot['display']['dashboard']>
  pageIndex: number
  pageCount: number
  results: Record<string, SpeedDialResult>
}

export interface SpeedDialRunRequest {
  id: string
  token?: string
  revision?: number
}

export interface SpeedDialDisplayButton {
  id: string
  label: string
  color: number | null
  iconId: string
  iconIndex: number
  status: 'idle' | 'running' | 'success' | 'error'
  enabled: boolean
}

export interface StudioSettings
  extends Omit<Settings, 'mappings' | 'deviceAppearance' | 'modules'> {
  mappings: Record<Status, string | null>
  deviceAppearance: DeviceAppearanceSettings
  modules: Omit<Settings['modules'], 'speedDial'> & { speedDial: SpeedDialSettings }
}

export interface BoardProfile {
  id: string
  name: string
  status: 'tested' | 'experimental'
  display: { width: number; height: number; shape: 'round' | 'rectangular' }
}

export interface StudioSnapshot {
  attention?: AttentionState
  seq: number
  module: ModuleId

  settings: StudioSettings
  settingsRevision: number

  deviceAppearance?: {
    mode: DeviceTheme | 'system'
    resolved: DeviceTheme
    system: DeviceTheme
    palette: DevicePalette
    design: Record<ModuleId, Record<string, number>>
  }

  connected: boolean
  error: string | null

  selected: string
  expression: string | null
  agents: { id: string; name: string; kind: string; project: string; state: string }[]

  display: {
    state: string
    label: string
    name: string
    nameShimmer?: boolean
    expression?: string
    counts?: Record<string, number>

    dashboard?: {
      screenShape?: 'round' | 'rectangular'
      layout?: 'grid' | 'list'
      gridSize?: 0 | 4 | 6
      listRows?: 3 | 4
      showLabels?: boolean
      buttons?: SpeedDialDisplayButton[]

      pickerOpen?: boolean
      devices?: AudioPickerDevice[]
      nextDeviceId?: number
      deviceCount?: number
      scope?: AudioScope
      deviceId?: number
      deviceName?: string
      volume?: number | null
      muted?: boolean | null
      canVolume?: boolean
      canMute?: boolean

      status: string
      refreshing?: boolean
      title: string
      detail: string

      player?: PlayerId
      playerName?: string
      players?: PlayerSummary[]
      canLike?: boolean
      liked?: boolean
      track?: string
      artist?: string
      artId?: string
      expanded?: boolean
      playing?: boolean
      canPrevious?: boolean
      canNext?: boolean

      time?: string
      weekday?: string
      blinkSeparator?: boolean

      pageIndex?: number
      pageCount?: number
      openToken?: string

      primary?: {
        provider?: string
        label: string
        remaining: number | null
        reset: string
        openable?: boolean
      }

      secondary?: {
        provider?: string
        label: string
        remaining: number | null
        reset: string
        openable?: boolean
      }

      items?: (Pick<HeyItem, 'sender' | 'subject'> & { openable?: boolean })[]
    }
  }

  changedAt: number
  animationMs: number
  ageMs: number
  updatedAt: number | null

  layout: { textGap: number }

  device: {
    profile?: BoardProfile | null
    fontError?: boolean
    status: string
    port: string | null
    error: string | null
    lastAck?: number
    renderedModule?: string
    connection?: SerialConnectionState
  }

  pointer: {
    supported: boolean
    enabled: boolean
    intervalMs: number

    status: string
    error: string | null

    x: number
    y: number
  }

  modules: {
    usage: UsageSource
    hey: HeySource
    roon: RoonSource
    audio: AudioSource
    speedDial?: SpeedDialSource
  }
}

export const moduleNames: Record<ModuleId, string> = {
  face: 'Herdr Face',
  usage: 'CodexBar',
  hey: 'HEY',
  clock: 'Clock',
  roon: 'Now Playing',
  audio: 'Audio',
  speedDial: 'Speed Dial',
}

export const statusNames: Record<string, string> = {
  working: 'Working',
  blocked: 'Needs input',
  done: 'Ready',
  idle: 'Idle',
  unknown: 'Unknown',
  disconnected: 'Disconnected',
  sleep: 'Sleeping',
}

export const statusDescriptions: Record<Status, string> = {
  working: 'An agent is working on a task.',
  blocked: 'An agent needs your input to continue.',
  done: 'Work is ready for you to review.',
  idle: 'Your agents are taking a moment.',
  unknown: 'An agent has no reported status.',
  disconnected: 'The connection to Herdr is unavailable.',
}

export const boxes = {
  imbox: 'Imbox',
  feed: 'The Feed',
  paperTrail: 'Paper Trail',
  replyLater: 'Reply Later',
  screener: 'Screener',
}

export const animations = ['working', 'blocked', 'done', 'idle', 'sleep'].map((id) => ({
  id,
  label: statusNames[id],
  group: 'Originals',
}))

export const animationName = (id: string | null) =>
  id ? (animations.find((a) => a.id === id)?.label ?? id) : 'Default'

export function relativeTime(at: number | null | undefined) {
  if (!at) {
    return 'Not refreshed yet'
  }

  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000))

  return seconds < 60
    ? 'Updated just now'
    : seconds < 3600
      ? `Updated ${Math.floor(seconds / 60)}m ago`
      : `Updated ${Math.floor(seconds / 3600)}h ago`
}

export function resetTime(at: number | null) {
  if (!at) {
    return 'No reset time available'
  }

  const minutes = Math.max(0, Math.ceil((at - Date.now()) / 60000))

  return minutes < 1
    ? 'Resetting soon'
    : minutes < 60
      ? `Resets in ${minutes}m`
      : minutes < 1440
        ? `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

export function useStudio() {
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null)
  const [online, setOnline] = useState(false)
  const [pending, setPending] = useState(false)

  const busy = useRef(false)
  const refreshing = useRef(new Set<string>())

  useEffect(() => {
    const events = new EventSource('/api/events')

    events.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data)

        if (value.settings) {
          setSnapshot(value)
          setOnline(true)
        }
      } catch {
        /* Keep the last complete snapshot. */
      }
    }

    events.onerror = () => setOnline(false)

    return () => events.close()
  }, [])

  const action = useCallback(async (path: string, payload: unknown, message?: string) => {
    const refresh = path === 'modules/refresh'
    const refreshId = JSON.stringify(payload)

    if (refresh ? refreshing.current.has(refreshId) : busy.current) {
      return false
    }

    if (refresh) {
      refreshing.current.add(refreshId)
    } else {
      busy.current = true
      setPending(true)
    }

    try {
      const response = await fetch(`/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'The change could not be saved.')
      }

      // SSE is authoritative; a slower POST response must not replace a newer event.
      if (message) {
        toast.success(message)
      }

      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not reach the bridge.')
      return false
    } finally {
      if (refresh) {
        refreshing.current.delete(refreshId)
      } else {
        busy.current = false
        setPending(false)
      }
    }
  }, [])

  const save = useCallback(
    (patch: unknown, message = 'Settings saved') => action('settings', patch, message),
    [action],
  )

  return { snapshot, online, pending, action, save }
}

export type Save = (patch: unknown, message?: string) => Promise<boolean>

export type Action = (path: string, payload: unknown, message?: string) => Promise<boolean>

export interface PageProps {
  snapshot: StudioSnapshot
  pending: boolean
  save: Save
  action: Action
}
