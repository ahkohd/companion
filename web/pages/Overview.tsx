import {
  Check,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Radio,
  Search,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { moduleIcons, Panel, SourceBadge, StatusDot } from '../components/page-ui'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import type { PageProps } from '../lib/studio'
import { moduleNames, statusNames } from '../lib/studio'

export default function Overview({
  snapshot: s,
  pending,
  action,
  openModules,
}: PageProps & { openModules: () => void }) {
  const [search, setSearch] = useState('')

  const counts = { working: 0, done: 0, idle: 0, blocked: 0 }

  for (const agent of s.agents) {
    if (agent.state in counts) {
      counts[agent.state as keyof typeof counts]++
    }
  }

  const agents = s.agents.filter((a) =>
    `${a.name} ${a.project} ${a.kind}`.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <>
      <div className="overview-summary">
        <div className="summary-icon">
          <Sparkles size={21} />
        </div>

        <div>
          <h2>
            {counts.blocked
              ? 'A little attention needed'
              : counts.working
                ? 'Good things are in progress'
                : counts.done
                  ? 'Something is ready for you'
                  : 'A quiet moment at your desk'}
          </h2>
          <p>
            {!s.connected
              ? 'Connect Herdr to see your agents here.'
              : counts.blocked
                ? `${counts.blocked} ${counts.blocked === 1 ? 'agent is' : 'agents are'} waiting for your input.`
                : counts.working
                  ? `${counts.working} ${counts.working === 1 ? 'agent is' : 'agents are'} working. Your companion is keeping you company.`
                  : counts.done
                    ? 'Your agents have work ready to review.'
                    : 'Your companion will light up when things get moving.'}
          </p>
        </div>
      </div>

      <div className="stats-grid">
        {(['working', 'done', 'idle'] as const).map((state) => (
          <div className="stat" key={state}>
            <div>
              <StatusDot state={state} />
              {statusNames[state]}
            </div>
            <strong>{counts[state]}</strong>
          </div>
        ))}
      </div>

      <Panel
        title="Your agents"
        description="Choose an agent to follow on your screen."
        action={
          <Badge variant="secondary" className={s.connected ? 'is-good' : ''}>
            <StatusDot state={s.connected ? 'connected' : 'idle'} />
            {s.connected ? 'Herdr live' : 'Offline'}
          </Badge>
        }
      >
        <div className="agent-search">
          <Search size={16} />
          <Input
            aria-label="Search agents"
            placeholder="Find an agent or project"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`all-agents-row ${s.selected === 'all' && s.module === 'face' ? 'selected' : ''}`}
          disabled={pending || !s.settings.modules.face.enabled}
          onClick={() => void action('select', { id: 'all' })}
        >
          <span className="all-agents-icon">
            <LayoutDashboard size={18} />
          </span>
          <span>
            <strong>All agents</strong>
            <small>The bigger picture, at a glance</small>
          </span>
          <span className="agent-count">{s.agents.length}</span>
          {s.selected === 'all' && s.module === 'face' ? (
            <span className="selected-check">
              <Check size={12} />
            </span>
          ) : (
            <ChevronRight size={16} />
          )}
        </button>
        <div className="agent-list">
          {agents.length ? (
            agents.map((agent) => (
              <button
                type="button"
                key={agent.id}
                className={`agent-row ${s.selected === agent.id && s.module === 'face' ? 'selected' : ''}`}
                disabled={pending || !s.settings.modules.face.enabled}
                onClick={() => void action('select', { id: agent.id })}
              >
                <span className={`agent-avatar agent-${agent.kind.toLowerCase()}`}>
                  {agent.kind.slice(0, 1).toUpperCase()}
                </span>
                <span className="agent-info">
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.project || 'No project'}
                    <span>/</span>
                    {agent.kind}
                  </small>
                </span>
                <span className="agent-state">
                  <StatusDot state={agent.state} />
                  {statusNames[agent.state] || agent.state}
                </span>
                {s.selected === agent.id && s.module === 'face' && <Check size={14} />}
              </button>
            ))
          ) : (
            <div className="empty-state">
              <Radio size={25} />
              <h3>
                {search
                  ? 'No matching agents'
                  : s.connected
                    ? 'Room for your next idea'
                    : 'Waiting for Herdr'}
              </h3>
              <p>
                {search
                  ? 'Try a different name or project.'
                  : s.connected
                    ? 'Start an agent in Herdr and it will appear here.'
                    : 'Open Herdr on this computer. Your agents will appear as soon as it connects.'}
              </p>
            </div>
          )}
        </div>

        <div className="panel-footnote">
          <CircleHelp size={13} />
          {s.settings.modules.face.enabled
            ? 'Tap the face on your device to cycle through agents.'
            : 'Enable Herdr Face in Modules to follow agents on your device.'}
        </div>
      </Panel>

      <Panel
        title="More than a face"
        description="Bring the rest of your day into view."
        className="module-shortcuts"
      >
        {(['usage', 'hey', 'clock', 'roon', 'audio', 'speedDial'] as const).map((id) => {
          const Icon = moduleIcons[id]

          return (
            <button type="button" className="shortcut-row" key={id} onClick={openModules}>
              <span className={`module-icon module-${id}`}>
                <Icon size={19} />
              </span>
              <span>
                <strong>{moduleNames[id]}</strong>
                <small>
                  {id === 'usage'
                    ? 'Your AI usage, at a glance'
                    : id === 'hey'
                      ? 'A quieter view of your inbox'
                      : id === 'roon'
                        ? 'Your music, within reach'
                        : id === 'speedDial'
                          ? 'Your everyday actions, a tap away'
                          : id === 'audio'
                            ? 'Sound, at your fingertips'
                            : 'A little space for the time'}
                </small>
              </span>
              {id === 'speedDial' ? (
                <Badge variant="secondary">Built in</Badge>
              ) : id === 'audio' ? (
                <Badge variant="secondary">Mac audio</Badge>
              ) : id === 'clock' ? (
                <Badge variant="secondary">Built in</Badge>
              ) : (
                <SourceBadge
                  source={s.modules[id]}
                  enabled={s.settings.modules[id].enabled}
                  network={id === 'roon'}
                />
              )}
              <ChevronRight size={16} />
            </button>
          )
        })}
      </Panel>
    </>
  )
}
