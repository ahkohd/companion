import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Monitor,
  RefreshCw,
  Shapes,
} from 'lucide-react'
import { useState } from 'react'
import AudioSettings from '../components/AudioSettings'
import {
  moduleIcons,
  Panel,
  SelectField,
  SettingRow,
  SourceBadge,
  StatusDot,
} from '../components/page-ui'
import RoonSettings from '../components/RoonSettings'
import SpeedDialSettings from '../components/SpeedDialSettings'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Switch } from '../components/ui/switch'
import type { PageProps } from '../lib/studio'
import { boxes, type ModuleId, moduleNames, relativeTime, resetTime } from '../lib/studio'

export default function Modules({ snapshot: s, pending, save, action }: PageProps) {
  const [expanded, setExpanded] = useState<ModuleId | null>('usage')

  const order = s.settings.device.moduleOrder as ModuleId[]
  const enabled = order.filter((id) => s.settings.modules[id].enabled)

  const descriptions: Record<ModuleId, string> = {
    face: 'A face for your agents. A feeling for their progress.',
    usage: 'See what is left before your next reset.',
    hey: 'Keep a little space for your inbox.',
    clock: 'The time, with a little room to breathe.',
    roon: 'Your music, within reach.',
    audio: 'Control your microphone and speakers.',
    speedDial: 'Your apps, shortcuts and commands, a tap away.',
  }

  const move = (id: ModuleId, direction: number) => {
    const next = [...order]
    const index = next.indexOf(id)
    const target = index + direction

    if (index < 0 || target < 0 || target >= next.length) {
      return
    }

    ;[next[index], next[target]] = [next[target], next[index]]
    void save({ device: { moduleOrder: next } }, 'Module order saved')
  }

  return (
    <>
      <div className="section-intro">
        <span className="round-icon">
          <Shapes size={19} />
        </span>
        <div>
          <h2>One screen, your essentials</h2>
          <p>Turn on the modules you want. Swipe between them on your device.</p>
        </div>
        <Badge variant="secondary">{enabled.length} enabled</Badge>
      </div>

      <div className="module-cards">
        {order.map((id, index) => {
          const Icon = moduleIcons[id]
          const config = s.settings.modules[id]
          const source = id === 'usage' || id === 'hey' || id === 'roon' ? s.modules[id] : null

          return (
            <Panel className={`module-card ${config.enabled ? 'enabled' : ''}`} key={id}>
              <div className="module-card-heading">
                <span className={`module-icon module-${id}`}>
                  <Icon size={23} />
                </span>
                <div>
                  <h2>
                    {moduleNames[id]}
                    {!source && <span className="built-in">Built in</span>}
                  </h2>
                  <p>{descriptions[id]}</p>
                </div>
                <Switch
                  checked={config.enabled}
                  disabled={pending || (config.enabled && enabled.length === 1)}
                  aria-label={`Enable ${moduleNames[id]}`}
                  onCheckedChange={(checked) =>
                    void save(
                      { modules: { [id]: { enabled: checked } } },
                      `${moduleNames[id]} ${checked ? 'enabled' : 'disabled'}`,
                    )
                  }
                />
              </div>

              <div className="module-meta">
                {source ? (
                  <SourceBadge source={source} enabled={config.enabled} network={id === 'roon'} />
                ) : id === 'speedDial' ? (
                  <Badge variant="secondary">{config.enabled ? 'Ready' : 'Off'}</Badge>
                ) : id === 'audio' ? (
                  <Badge
                    variant="secondary"
                    className={
                      config.enabled && s.modules.audio?.status === 'ready' ? 'is-good' : ''
                    }
                  >
                    {!config.enabled
                      ? 'Off'
                      : s.modules.audio?.status === 'ready'
                        ? 'Connected'
                        : 'Unavailable'}
                  </Badge>
                ) : id === 'clock' ? (
                  <Badge variant="secondary">Computer time</Badge>
                ) : (
                  <Badge variant="secondary" className={s.connected ? 'is-good' : ''}>
                    <StatusDot state={s.connected ? 'connected' : 'idle'} />
                    {s.connected ? 'Herdr connected' : 'Waiting for Herdr'}
                  </Badge>
                )}
                <span className="module-meta-note">
                  {id === 'speedDial'
                    ? `${s.settings.modules.speedDial.buttons.length} buttons`
                    : id === 'audio'
                      ? s.modules.audio?.deviceName || 'Mac input and output'
                      : id === 'roon'
                        ? s.modules.roon?.playerName || 'Spotify, Apple Music, Roon and macOS'
                        : source?.version
                          ? `CLI ${source.version}`
                          : id === 'face'
                            ? 'Live agent states'
                            : id === 'clock'
                              ? 'Updates automatically'
                              : source?.installed === true
                                ? 'Detected on this computer'
                                : source?.installed === false
                                  ? 'Install the CLI to connect'
                                  : 'Checking this computer'}
                </span>
                <div className="order-controls">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${moduleNames[id]} earlier`}
                    disabled={pending || index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${moduleNames[id]} later`}
                    disabled={pending || index === order.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown size={13} />
                  </Button>
                </div>
              </div>

              <div className="module-card-actions">
                <Button
                  variant={s.module === id ? 'secondary' : 'outline'}
                  disabled={!config.enabled || pending}
                  onClick={() =>
                    void action('module', { id }, `${moduleNames[id]} is on your device`)
                  }
                >
                  {s.module === id ? <Check size={14} /> : <Monitor size={14} />}
                  {s.module === id ? 'On device' : 'Show on device'}
                </Button>
                {id !== 'face' && (
                  <Button
                    variant="ghost"
                    aria-expanded={expanded === id}
                    onClick={() => setExpanded(expanded === id ? null : id)}
                  >
                    Configure
                    <ChevronDown size={14} className={expanded === id ? 'turned' : ''} />
                  </Button>
                )}
              </div>

              {expanded === id && id !== 'face' && (
                <div className="module-details">
                  {id === 'usage' ? (
                    <UsageSettings snapshot={s} pending={pending} save={save} action={action} />
                  ) : id === 'hey' ? (
                    <HeySettings snapshot={s} pending={pending} save={save} action={action} />
                  ) : id === 'roon' ? (
                    <RoonSettings snapshot={s} pending={pending} save={save} action={action} />
                  ) : id === 'speedDial' ? (
                    <SpeedDialSettings snapshot={s} pending={pending} save={save} action={action} />
                  ) : id === 'audio' ? (
                    <AudioSettings snapshot={s} pending={pending} action={action} />
                  ) : (
                    <ClockSettings snapshot={s} pending={pending} save={save} action={action} />
                  )}
                </div>
              )}
            </Panel>
          )
        })}
      </div>

      <Panel title="Swipe navigation" description="Your enabled modules appear in this order.">
        <div className="module-order">
          {enabled.map((id, index) => (
            <div key={id}>
              {index > 0 && <ChevronRight size={14} />}
              <span>
                {index + 1}
                <strong>{moduleNames[id]}</strong>
              </span>
            </div>
          ))}
        </div>
        <SettingRow
          title="Swipe to switch"
          description="Swipe left or right on the physical screen."
        >
          <Switch
            checked={s.settings.device.swipeEnabled}
            disabled={pending}
            aria-label="Swipe to switch modules"
            onCheckedChange={(value) => void save({ device: { swipeEnabled: value } })}
          />
        </SettingRow>
      </Panel>
    </>
  )
}

function ClockSettings({ snapshot: s, pending, save }: PageProps) {
  const config = s.settings.modules.clock

  return (
    <div className="clock-settings">
      <SelectField
        label="Time format"
        value={config.hourFormat}
        disabled={pending}
        onChange={(hourFormat) => void save({ modules: { clock: { hourFormat } } })}
      >
        <option value="12">12-hour (5:20)</option>
        <option value="24">24-hour (17:20)</option>
      </SelectField>
      <SettingRow title="Show weekday" description="Place the day below the time.">
        <Switch
          aria-label="Show weekday"
          checked={config.showWeekday}
          disabled={pending}
          onCheckedChange={(showWeekday) => void save({ modules: { clock: { showWeekday } } })}
        />
      </SettingRow>
      <SettingRow title="Blink separator" description="Blink the colon once per second.">
        <Switch
          aria-label="Blink separator"
          checked={config.blinkSeparator}
          disabled={pending}
          onCheckedChange={(blinkSeparator) =>
            void save({ modules: { clock: { blinkSeparator } } })
          }
        />
      </SettingRow>
      <p className="privacy-note">
        Synced with your computer's local time while the bridge is running.
      </p>
    </div>
  )
}

function UsageSettings({ snapshot: s, pending, save, action }: PageProps) {
  const source = s.modules.usage
  const config = s.settings.modules.usage

  return (
    <>
      <div className="module-fields">
        <SelectField
          label="Provider on device"
          value={config.provider}
          onChange={(provider) => void save({ modules: { usage: { provider } } })}
          disabled={pending}
        >
          <option value="auto">All configured providers</option>
          {config.provider !== 'auto' &&
            !source.providers.some((p) => p.id === config.provider) && (
              <option value={config.provider}>{config.provider} (saved)</option>
            )}

          {source.providers.map((p) => (
            <option value={p.id} key={p.id}>
              {p.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Refresh interval"
          value={config.refreshSeconds}
          onChange={(value) => void save({ modules: { usage: { refreshSeconds: Number(value) } } })}
          disabled={pending}
        >
          {[30, 60, 120, 300].map((n) => (
            <option value={n} key={n}>
              {n < 60 ? `${n} seconds` : `${n / 60} ${n === 60 ? 'minute' : 'minutes'}`}
            </option>
          ))}
        </SelectField>
      </div>

      {source.error && (
        <p className="source-message" role="status">
          {source.error}
        </p>
      )}

      {s.module === 'usage' && (s.display.dashboard?.pageCount ?? 1) > 1 && (
        <div className="usage-paging">
          <span>
            Device cards{' '}
            <small>
              {(s.display.dashboard?.pageIndex ?? 0) + 1} of {s.display.dashboard?.pageCount}
            </small>
          </span>
          <div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous usage cards"
              disabled={pending || source.status !== 'ready'}
              onClick={() => void action('usage/page', { direction: -1 })}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next usage cards"
              disabled={pending || source.status !== 'ready'}
              onClick={() => void action('usage/page', { direction: 1 })}
            >
              <ArrowDown size={14} />
            </Button>
          </div>
        </div>
      )}

      {source.providers.map((provider) => (
        <div className="usage-readout" key={provider.id}>
          <div className="readout-heading">
            <strong>{provider.label}</strong>
            <span>{provider.plan || 'Usage remaining'}</span>
          </div>

          {provider.windows.map((window) => {
            const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent))

            const label = window.label.startsWith(`${provider.label} `)
              ? window.label.slice(provider.label.length + 1)
              : window.label

            return (
              <div
                className="usage-window"
                key={window.id}
                data-level={remaining <= 10 ? 'low' : remaining <= 25 ? 'caution' : 'normal'}
              >
                <div>
                  <strong>
                    <span className="pixel-number">{Math.round(remaining)}%</span>{' '}
                    <small>left</small>
                  </strong>
                  <span className="usage-window-label" title={window.label}>
                    {label}
                  </span>
                </div>

                <div
                  className="usage-track"
                  role="meter"
                  aria-label={`${window.label} remaining`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={remaining}
                >
                  <span style={{ width: `${remaining}%` }} />
                </div>
                <p>{resetTime(window.resetAt)}</p>
              </div>
            )
          })}

          {!provider.windows.length && <p className="source-hint">No usage windows available.</p>}
        </div>
      ))}

      {!config.enabled && (
        <p className="source-hint">
          CodexBar is detected automatically. Enable this module to read your configured providers.
        </p>
      )}

      <div className="module-detail-footer">
        <span>{relativeTime(source.updatedAt)}</span>
        <Button
          variant="ghost"
          disabled={pending || source.refreshing || source.status === 'loading'}
          onClick={() => void action('modules/refresh', { id: 'usage' }, 'CodexBar checked')}
        >
          <RefreshCw size={13} />
          {source.refreshing ? 'Checking' : 'Refresh'}
        </Button>
      </div>
      <p className="privacy-note">
        Uses your existing CodexBar connection. Provider accounts stay in CodexBar.
      </p>
    </>
  )
}

function HeySettings({ snapshot: s, pending, save, action }: PageProps) {
  const source = s.modules.hey
  const config = s.settings.modules.hey

  const ready =
    config.enabled &&
    source.status === 'ready' &&
    source.selectedBox === config.box &&
    Array.isArray(source.items)

  const items = ready ? (source.items ?? []) : []
  const pageCount = s.display.dashboard?.pageCount ?? 1

  return (
    <>
      <div className="module-fields">
        <SelectField
          label="Mailbox on device"
          value={config.box}
          onChange={(box) => void save({ modules: { hey: { box } } })}
          disabled={pending}
        >
          {Object.entries(boxes).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Update spacing"
          value={config.refreshSeconds}
          onChange={(value) => void save({ modules: { hey: { refreshSeconds: Number(value) } } })}
          disabled={pending}
        >
          {[30, 60, 120, 300].map((n) => (
            <option value={n} key={n}>
              {n < 60 ? `${n} seconds` : `${n / 60} ${n === 60 ? 'minute' : 'minutes'}`}
            </option>
          ))}
        </SelectField>
      </div>

      {source.error && (
        <p className="source-message" role="status">
          {source.error}
        </p>
      )}

      {ready && (
        <section
          className="hey-mail-list"
          aria-label={`${boxes[config.box as keyof typeof boxes]} messages`}
        >
          <div className="readout-heading">
            <strong>{boxes[config.box as keyof typeof boxes]}</strong>
            <span>{config.box === 'screener' ? 'Waiting to be screened' : 'Recent mail'}</span>
          </div>

          {items.length ? (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <strong dir="auto">{item.sender}</strong>
                  <p dir="auto">{item.subject}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hey-mail-empty">
              {config.box === 'imbox' ? 'You are all caught up.' : 'Nothing here yet.'}
            </p>
          )}
        </section>
      )}

      {ready && s.module === 'hey' && pageCount > 1 && (
        <div className="usage-paging">
          <span>
            On your device{' '}
            <small>
              {(s.display.dashboard?.pageIndex ?? 0) + 1} of {pageCount}
            </small>
          </span>
          <div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous mail"
              disabled={pending}
              onClick={() => void action('hey/page', { direction: -1 })}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next mail"
              disabled={pending}
              onClick={() => void action('hey/page', { direction: 1 })}
            >
              <ArrowDown size={14} />
            </Button>
          </div>
        </div>
      )}
      <p className="source-hint">
        {!config.enabled
          ? 'Enable this module to see mail using your existing HEY sign-in.'
          : ready && items.length
            ? `${items.length > 3 ? 'Swipe up or down on the device to browse.' : 'Your recent mail, ready at a glance.'}${source.hasMore ? ' Recent mail only; open HEY for older messages.' : ''}`
            : config.box === 'screener'
              ? 'HEY checks for new senders at the selected interval.'
              : 'HEY watches for mailbox changes.'}
      </p>
      <div className="module-detail-footer">
        <span>{relativeTime(source.updatedAt)}</span>
        <Button
          variant="ghost"
          disabled={pending || source.refreshing || source.status === 'loading'}
          onClick={() => void action('modules/refresh', { id: 'hey' }, 'HEY checked')}
        >
          <RefreshCw size={13} />
          {source.refreshing ? 'Checking' : 'Refresh'}
        </Button>
      </div>
      <p className="privacy-note">Shows senders and subjects without marking messages as read.</p>
    </>
  )
}
