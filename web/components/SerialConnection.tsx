import { Check, Monitor, RefreshCw, RotateCcw, Usb } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Action, SerialConnectionState, StudioSnapshot } from '../lib/studio'
import { Button } from './ui/button'
import './serial-connection.css'

type Mode = SerialConnectionState['mode']

const modes = [
  { id: 'auto', label: 'Automatic', Icon: Usb },
  { id: 'manual', label: 'Choose a port', Icon: Usb },
  { id: 'off', label: 'Browser only', Icon: Monitor },
] as const

export default function SerialConnection({
  snapshot: s,
  pending,
  action,
}: {
  snapshot: StudioSnapshot
  pending: boolean
  action: Action
}) {
  const connection = s.device.connection

  const [mode, setMode] = useState<Mode>(connection?.mode || 'auto')
  const [path, setPath] = useState(connection?.path || '')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) {
      setMode(connection?.mode || 'auto')
      setPath(connection?.path || '')
    }
  }, [connection?.mode, connection?.path, editing])

  const ports = connection?.ports || []
  const selected = ports.find((port) => port.path === path)
  const remembered = path && !selected

  const changed =
    !!connection && (mode !== connection.mode || (mode === 'manual' && path !== connection.path))

  const unavailable = pending || !connection
  const busy = unavailable || connection?.scanning === true
  const canApply = changed && !busy && (mode !== 'manual' || !!selected)
  const active = ports.find((port) => port.path === s.device.port)
  const errors = [...new Set([connection?.error, s.device.error].filter(Boolean))]

  const discard = () => {
    setMode(connection?.mode || 'auto')
    setPath(connection?.path || '')
    setEditing(false)
  }

  return (
    <section className="serial-connection" aria-label="USB connection">
      <div className="serial-heading">
        <div>
          <h3>USB connection</h3>
          <p>Connect your companion or use the playground on its own.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void action('device/refresh', {})}
        >
          <RefreshCw size={13} className={connection?.scanning ? 'serial-scanning' : ''} />
          {connection?.scanning ? 'Scanning' : 'Refresh ports'}
        </Button>
      </div>

      <div className="serial-modes" role="group" aria-label="Connection mode">
        {modes.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            disabled={unavailable}
            aria-pressed={mode === id}
            onClick={() => {
              setMode(id)
              setEditing(true)
            }}
          >
            <Icon size={15} />
            <span>{label}</span>
            {mode === id && <Check size={12} />}
          </button>
        ))}
      </div>
      <p className="serial-mode-note">
        {mode === 'auto'
          ? 'Find a compatible device automatically when it is plugged in.'
          : mode === 'manual'
            ? 'Use a specific USB serial port. Your selection is remembered.'
            : 'Keep the playground available without connecting to USB.'}
      </p>
      {mode === 'manual' && (
        <div className="serial-port-field">
          <label htmlFor="companion-serial-port">Serial port</label>
          <select
            id="companion-serial-port"
            value={path}
            disabled={busy}
            onChange={(event) => {
              setPath(event.target.value)
              setEditing(true)
            }}
          >
            <option value="" disabled>
              {ports.length ? 'Choose a detected port' : 'No serial ports detected'}
            </option>
            {remembered && (
              <option value={path} disabled>
                {path} — disconnected
              </option>
            )}

            {ports.map((port) => (
              <option key={port.path} value={port.path}>
                {port.manufacturer ? `${port.manufacturer} · ` : ''}
                {port.path}
                {port.compatible ? ' · Compatible' : ''}
              </option>
            ))}
          </select>
          {remembered ? (
            <p className="serial-port-note">
              This port is not connected. Plug in the device, refresh, or choose another port.
            </p>
          ) : selected?.serialNumber ? (
            <p className="serial-port-note">
              Serial number <code>{selected.serialNumber}</code>
            </p>
          ) : null}
        </div>
      )}

      <div className="serial-footer">
        <div className="serial-current" role="status">
          {changed ? (
            <span>Connection changes are not applied yet.</span>
          ) : !connection ? (
            <span>Connection controls will appear when the bridge reconnects.</span>
          ) : connection.mode === 'off' ? (
            <span>Browser only · USB is off</span>
          ) : s.device.port ? (
            <>
              <span>{s.device.status === 'connected' ? 'Connected port' : 'Waiting on port'}</span>
              <code>{s.device.port}</code>
              {(active?.serialNumber || connection.serialNumber) && (
                <small>Serial {active?.serialNumber || connection.serialNumber}</small>
              )}
            </>
          ) : (
            <span>
              {connection.scanning ? 'Looking for a device…' : 'Waiting for a compatible device'}
            </span>
          )}
        </div>

        <div className="serial-buttons">
          {changed ? (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={discard}>
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canApply}
                onClick={async () => {
                  if (
                    await action(
                      'device/connection',
                      { mode, ...(mode === 'manual' ? { path } : {}) },
                      'Connection updated',
                    )
                  ) {
                    setEditing(false)
                  }
                }}
              >
                Apply connection
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || connection?.mode === 'off'}
              onClick={() => void action('device/reconnect', {}, 'Reconnecting to your device')}
            >
              <RotateCcw size={13} />
              Reconnect
            </Button>
          )}
        </div>
      </div>

      {errors.map((error) => (
        <p className="serial-error" role="alert" key={error}>
          {error}
        </p>
      ))}
    </section>
  )
}
