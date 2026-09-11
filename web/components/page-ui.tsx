import {
  Activity,
  ChevronDown,
  Clock,
  LayoutGrid,
  Mail,
  Music2,
  Smile,
  Volume2,
} from 'lucide-react'
import { type ReactNode, useId } from 'react'
import type { Source } from '../lib/studio'
import { Badge } from './ui/badge'

export function StatusDot({ state = 'idle' }: { state?: string }) {
  return <span aria-hidden="true" className={`state-dot state-${state}`} />
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>
}

export function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-header">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}

      {children}
    </section>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  children,
  disabled = false,
  compact = false,
}: {
  label: string
  value: string | number
  onChange: (value: string) => void
  children: ReactNode
  disabled?: boolean
  compact?: boolean
}) {
  const id = useId()

  return (
    <div className={`select-field ${compact ? 'compact' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="select-wrap">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {children}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </div>
  )
}

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function SourceBadge({
  source,
  enabled,
  network = false,
}: {
  source: Source
  enabled: boolean
  network?: boolean
}) {
  const label =
    !network && source.installed === false
      ? 'CLI not found'
      : !network && source.installed === null
        ? 'Detecting CLI'
        : !enabled
          ? network
            ? 'Off'
            : 'CLI detected'
          : source.refreshing && source.status === 'ready'
            ? 'Checking'
            : source.status === 'ready'
              ? 'Connected'
              : source.status === 'loading'
                ? 'Connecting'
                : source.status === 'auth-required'
                  ? network
                    ? 'Permission needed'
                    : 'Sign in needed'
                  : 'Needs attention'

  return (
    <Badge
      variant="secondary"
      className={`source-badge ${source.status === 'ready' && enabled ? 'is-good' : ''}`}
    >
      <StatusDot
        state={
          source.refreshing || source.status === 'loading'
            ? 'working'
            : source.status === 'ready' && enabled
              ? 'connected'
              : 'idle'
        }
      />
      {label}
    </Badge>
  )
}

export function Thumbnail({ id, className = '' }: { id: string | null; className?: string }) {
  return (
    <div className={`animation-thumb ${className}`} aria-hidden="true">
      <div className={`mini-eyes mini-${id || 'idle'}`}>
        <i />
        <i />
      </div>
    </div>
  )
}

export const moduleIcons = {
  face: Smile,
  usage: Activity,
  hey: Mail,
  clock: Clock,
  roon: Music2,
  audio: Volume2,
  speedDial: LayoutGrid,
}
