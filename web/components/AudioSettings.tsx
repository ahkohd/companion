import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import { useState } from 'react'
import type { Action, AudioControlRequest, AudioSource, StudioSnapshot } from '../lib/studio'
import { Button } from './ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import './audio.css'

function AudioControls({
  source,
  pending,
  action,
}: {
  source: AudioSource
  pending: boolean
  action: Action
}) {
  const [draft, setDraft] = useState<number | null>(null)

  const ready = source.status === 'ready' && !pending
  const volume = draft ?? source.volume

  const send = (request: Pick<AudioControlRequest, 'action' | 'value'>) =>
    action('audio/control', { scope: source.scope, deviceId: source.deviceId, ...request })

  const commit = () => {
    if (draft !== null) {
      const value = draft
      setDraft(null)

      if (value !== source.volume) {
        void send({ action: 'volume', value })
      }
    }
  }

  const devices = source.scope === 'input' ? source.inputs : source.outputs

  return (
    <>
      <div className="audio-device-picker">
        <label id={`audio-device-label-${source.scope}`} htmlFor={`audio-device-${source.scope}`}>
          {source.scope === 'input' ? 'Input device' : 'Output device'}
        </label>
        <Select
          value={source.deviceId}
          disabled={pending || !devices.length}
          onValueChange={(value) => {
            if (value !== null && value !== source.deviceId) {
              void send({ action: 'device', value })
            }
          }}
        >
          <SelectTrigger
            className="audio-device-trigger"
            id={`audio-device-${source.scope}`}
            aria-labelledby={`audio-device-label-${source.scope}`}
          >
            <SelectValue>
              {devices.find((device) => device.id === source.deviceId)?.name ||
                source.deviceName ||
                'Choose a device'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {devices.map((device) => (
              <SelectItem key={device.id} value={device.id}>
                {device.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="audio-volume-heading">
        <label htmlFor={`audio-volume-${source.scope}`}>
          {source.scope === 'input' ? 'Input level' : 'Volume'}
        </label>
        <output>{volume === null ? 'Unavailable' : `${Math.round(volume)}%`}</output>
      </div>
      <input
        id={`audio-volume-${source.scope}`}
        className="audio-volume-slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume ?? 0}
        disabled={!ready || !source.canVolume || source.volume === null}
        aria-valuetext={volume === null ? 'Unavailable' : `${Math.round(volume)} percent`}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      {!source.canVolume && <p className="audio-note">This device manages its own volume.</p>}

      <div className="audio-mute-row">
        <Button
          variant="outline"
          disabled={!ready || !source.canMute || source.muted === null}
          aria-pressed={source.muted === true}
          onClick={() => void send({ action: 'mute', value: !source.muted })}
        >
          {source.scope === 'input' ? (
            source.muted ? (
              <MicOff size={16} />
            ) : (
              <Mic size={16} />
            )
          ) : source.muted ? (
            <VolumeX size={16} />
          ) : (
            <Volume2 size={16} />
          )}{' '}
          {source.muted ? 'Unmute' : 'Mute'}
        </Button>
        {!source.canMute && <span>Mute is unavailable for this device.</span>}
      </div>
    </>
  )
}

export default function AudioSettings({
  snapshot: s,
  pending,
  action,
}: {
  snapshot: StudioSnapshot
  pending: boolean
  action: Action
}) {
  const source = s.modules.audio

  if (!source) {
    return (
      <div className="audio-settings">
        <p className="audio-note">Connect the desktop bridge to manage audio.</p>
      </div>
    )
  }

  return (
    <div className="audio-settings">
      <div className="audio-scope-tabs" role="group" aria-label="Audio direction">
        {(['output', 'input'] as const).map((scope) => (
          <Button
            key={scope}
            variant={source.scope === scope ? 'secondary' : 'ghost'}
            aria-pressed={source.scope === scope}
            disabled={pending || !s.settings.modules.audio.enabled}
            onClick={() => void action('audio/page', { scope })}
          >
            {scope === 'input' ? <Mic size={16} /> : <Volume2 size={16} />}{' '}
            {scope === 'input' ? 'Input' : 'Output'}
          </Button>
        ))}
      </div>
      <AudioControls
        key={`${source.scope}-${source.deviceId}`}
        source={source}
        pending={pending || !s.settings.modules.audio.enabled}
        action={action}
      />
      {source.error && (
        <p className="source-message" role="status">
          {source.error}
        </p>
      )}
      <p className="audio-note">
        Swipe up or down on the device to switch between output and input. Tap the title, volume or
        device name to choose a device. Swipe up or down through the list, then select a device to
        return.
      </p>
    </div>
  )
}
