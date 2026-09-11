import {
  Activity,
  ArrowUpRight,
  Bell,
  ChevronRight,
  CircleHelp,
  Cpu,
  Eye,
  LayoutDashboard,
  type LucideIcon,
  Moon,
  Play,
  Settings2,
  Shapes,
  SlidersHorizontal,
  Smile,
  Sun,
  Unplug,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { version as appVersion } from '../package.json'
import AppSettings from './components/AppSettings'
import Attention from './components/Attention'
import CompanionMark from './components/CompanionMark'
import Designer from './components/Designer'
import DevicePreview from './components/DevicePreview'
import Logs from './components/Logs'
import { StatusDot } from './components/page-ui'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import type { Action } from './lib/studio'
import { animationName, type ModuleId, moduleNames, useStudio } from './lib/studio'
import Animations from './pages/Animations'
import DeviceSettings from './pages/DeviceSettings'
import Modules from './pages/Modules'
import Overview from './pages/Overview'

const navigation: { id: Page; label: string; icon: LucideIcon; description: string }[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    description: 'A little presence for everything you are working on.',
  },

  {
    id: 'animations',
    label: 'Animations',
    icon: Smile,
    description: 'Give every moment a little personality.',
  },
  { id: 'modules', label: 'Modules', icon: Shapes, description: '' },
  {
    id: 'attention',
    label: 'Attention',
    icon: Bell,
    description: 'The right message, at the right moment.',
  },

  {
    id: 'designer',
    label: 'Designer',
    icon: Settings2,
    description: 'Shape every detail of your companion.',
  },

  {
    id: 'logs',
    label: 'Logs',
    icon: Activity,
    description: 'Live diagnostics from your companion.',
  },

  {
    id: 'device',
    label: 'Device',
    icon: SlidersHorizontal,
    description: 'Make your companion feel right at home.',
  },

  {
    id: 'app-settings',
    label: 'Settings',
    icon: Settings2,
    description: 'Startup, updates, command line and agent skills.',
  },
]

type Page =
  | 'overview'
  | 'animations'
  | 'modules'
  | 'device'
  | 'designer'
  | 'attention'
  | 'logs'
  | 'app-settings'

const readPage = (): Page =>
  navigation.some((n) => n.id === location.hash.slice(1))
    ? (location.hash.slice(1) as Page)
    : 'overview'

export default function App() {
  const { snapshot, online, pending, action: bridgeAction, save } = useStudio()

  const [page, setPage] = useState<Page>(readPage)
  const [localAnimation, setLocalAnimation] = useState<string | undefined>()
  const [localReplay, setLocalReplay] = useState(0)

  const audition = (id: string | undefined) => {
    setLocalAnimation(id)
    setLocalReplay((value) => value + 1)
  }

  const action: Action = async (path, payload, message) => {
    const saved = await bridgeAction(path, payload, message)

    if (saved && ['select', 'module', 'expression'].includes(path)) {
      setLocalAnimation(undefined)
    }

    return saved
  }

  const [help, setHelp] = useState(false)

  useEffect(() => {
    const onHash = () => setPage(readPage())

    window.addEventListener('hashchange', onHash)

    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const deviceConnected = online && snapshot?.device.status === 'connected'

  const connectionLabel = !online
    ? 'Connecting'
    : deviceConnected
      ? 'Connected'
      : 'Device disconnected'

  const appearance = snapshot?.settings.appearance

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      document.documentElement.classList.toggle(
        'dark',
        appearance?.theme === 'dark' || (appearance?.theme === 'system' && query.matches),
      )
      document.documentElement.dir = appearance?.direction || 'ltr'
      document.documentElement.dataset.reduced = String(appearance?.reducedMotion || false)
    }

    apply()
    query.addEventListener('change', apply)

    return () => query.removeEventListener('change', apply)
  }, [appearance?.theme, appearance?.direction, appearance?.reducedMotion])

  const navigate = (next: Page) => {
    location.hash = next
    setPage(next)
  }

  const current = navigation.find((n) => n.id === page)!

  const switchModule = (id: ModuleId) => {
    setLocalAnimation(undefined)
    void action('module', { id }, `${moduleNames[id]} is on your device`)
  }

  const returnLive = () => {
    setLocalAnimation(undefined)

    if (snapshot?.expression !== null) {
      void action('expression', { expression: null }, 'Following live agent states')
    }
  }

  return (
    <div className="studio-shell">
      {/* biome-ignore lint/a11y/useValidAnchor: Focus main without changing the hash-based page. */}
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Companion home">
          <CompanionMark />
          <span>Companion</span>
        </a>
        <p className="nav-label">Workspace</p>
        <nav aria-label="Main navigation">
          {navigation
            .filter((item) => item.id !== 'app-settings')
            .map(({ id, label, icon: Icon }) => (
              <a
                key={id}
                href={`#${id}`}
                className={`nav-link ${page === id ? 'active' : ''}`}
                aria-label={label}
                aria-current={page === id ? 'page' : undefined}
              >
                <Icon size={18} />
                <span>{label}</span>
              </a>
            ))}
        </nav>

        <div className="sidebar-bottom">
          <button type="button" className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            Quick guide
            <ArrowUpRight size={14} />
          </button>
          <a
            href="#app-settings"
            className={`nav-link sidebar-settings ${page === 'app-settings' ? 'active' : ''}`}
            aria-label="Settings"
            aria-current={page === 'app-settings' ? 'page' : undefined}
          >
            <Settings2 size={18} />
            <span>Settings</span>
          </a>
          <div className="sidebar-version">
            Companion <span>v{appVersion}</span>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            <span>{current.label}</span>
          </div>

          <div className="topbar-actions">
            <div className="topbar-status" role="status">
              <StatusDot state={deviceConnected ? 'connected' : 'idle'} />
              {connectionLabel}
            </div>

            <div className="theme-controls" role="group" aria-label="Colour theme">
              <button
                type="button"
                aria-label="Use light theme"
                aria-pressed={appearance?.theme === 'light'}
                disabled={pending || !online}
                onClick={() => void save({ appearance: { theme: 'light' } })}
              >
                <Sun size={14} />
              </button>
              <button
                type="button"
                aria-label="Use dark theme"
                aria-pressed={appearance?.theme === 'dark'}
                disabled={pending || !online}
                onClick={() => void save({ appearance: { theme: 'dark' } })}
              >
                <Moon size={14} />
              </button>
            </div>
          </div>
        </header>

        {!online && snapshot && (
          <div className="offline-banner" role="status">
            <Unplug size={16} />
            Reconnecting to Companion. Showing the last received state. Changes are paused.
          </div>
        )}

        <main id="main" tabIndex={-1} className="main-content">
          <div className="page-heading">
            <div>
              <h1>{current.label}</h1>
              <p aria-hidden={current.description ? undefined : true}>
                {current.description || '\u00a0'}
              </p>
            </div>

            {page !== 'app-settings' && (
              <Badge variant="outline" className="device-badge">
                <Cpu size={13} />
                {snapshot?.device.profile
                  ? `${snapshot.device.profile.display.width} x ${snapshot.device.profile.display.height}`
                  : '1.75" AMOLED'}
              </Badge>
            )}
          </div>

          {page === 'app-settings' ? (
            <AppSettings />
          ) : page === 'logs' ? (
            <Logs />
          ) : page === 'designer' && snapshot ? (
            <Designer snapshot={snapshot} online={online} pending={pending} action={action} />
          ) : (
            <div className="content-grid">
              <div className="page-content">
                {!snapshot ? (
                  <div className="loading-panel" role="status">
                    <CompanionMark />
                    <h2>Waking things up</h2>
                    <p>Connecting to your local companion bridge.</p>
                    <p className="muted-small">
                      If this takes a moment, check that the bridge is running.
                    </p>
                  </div>
                ) : (
                  <>
                    {page === 'overview' && (
                      <Overview
                        snapshot={snapshot}
                        pending={pending || !online}
                        action={action}
                        save={save}
                        openModules={() => navigate('modules')}
                      />
                    )}

                    {page === 'animations' && (
                      <Animations
                        snapshot={snapshot}
                        pending={pending || !online}
                        action={action}
                        save={save}
                        audition={audition}
                        auditionId={localAnimation}
                      />
                    )}

                    {page === 'modules' && (
                      <Modules
                        snapshot={snapshot}
                        pending={pending || !online}
                        action={action}
                        save={save}
                      />
                    )}

                    {page === 'attention' && (
                      <Attention snapshot={snapshot} pending={pending || !online} action={action} />
                    )}

                    {page === 'device' && (
                      <DeviceSettings
                        snapshot={snapshot}
                        pending={pending || !online}
                        action={action}
                        save={save}
                      />
                    )}
                  </>
                )}
              </div>

              <aside className="preview-column" aria-label="Live device preview">
                <DevicePreview
                  snapshot={snapshot}
                  online={online}
                  pending={pending || !online}
                  localAnimation={localAnimation}
                  localReplay={localReplay}
                  onModule={switchModule}
                  onLive={returnLive}
                  onUsagePage={(direction) => void action('usage/page', { direction })}
                  onHeyPage={(direction) => void action('hey/page', { direction })}
                  onOpenCard={(request) => void action('open-card', request)}
                  onRoonControl={(control, player) =>
                    void action('roon/control', { action: control, player })
                  }
                  onRoonPage={(direction) => void action('roon/player', { direction })}
                  onRoonView={(expanded) => void action('roon/view', { expanded })}
                  onAudioControl={(request) => void action('audio/control', request)}
                  onAudioView={(request) => void action('audio/view', request)}
                  onAudioPage={(direction) => void action('audio/page', { direction })}
                  onSpeedDialRun={(request) => void action('speed-dial/run', request)}
                  onSpeedDialPage={(direction) => void action('speed-dial/page', { direction })}
                />
                {localAnimation !== undefined && (
                  <div className="audition-actions">
                    <div>
                      <Eye size={15} />
                      <span>
                        Previewing <strong>{animationName(localAnimation)}</strong>
                      </span>
                    </div>
                    <Button
                      disabled={pending || !online || !snapshot?.settings.modules.face.enabled}
                      onClick={async () => {
                        if (
                          await action(
                            'expression',
                            { expression: localAnimation },
                            'Animation sent to your device',
                          )
                        ) {
                          setLocalAnimation(undefined)
                        }
                      }}
                    >
                      <Play size={14} />
                      Send to device
                    </Button>
                  </div>
                )}
              </aside>
            </div>
          )}
        </main>
      </div>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="guide-dialog">
          <DialogHeader>
            <DialogTitle>A little companion for your desk</DialogTitle>
            <DialogDescription>
              Everything runs through the local bridge on this computer.
            </DialogDescription>
          </DialogHeader>
          <ol className="guide-steps">
            <li>
              <span>01</span>
              <div>
                <h3>Connect your screen</h3>
                <p>Plug your Waveshare in over USB. Device settings show its connection status.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Choose what matters</h3>
                <p>
                  Enable Herdr Face, CodexBar, HEY or Clock in Modules. Installed CLIs are detected
                  automatically.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Make it yours</h3>
                <p>
                  Map animations to agent states. Swipe left or right on the device to switch
                  enabled modules; tap the face to cycle agents.
                </p>
              </div>
            </li>
          </ol>
          <p className="guide-footnote">
            HEY shows senders and subjects without reading message bodies. The studio cannot send
            email or change your inbox.
          </p>
        </DialogContent>
      </Dialog>
      <Toaster
        position="bottom-right"
        closeButton
        theme={(appearance?.theme as 'light' | 'dark' | 'system') || 'light'}
      />
    </div>
  )
}
