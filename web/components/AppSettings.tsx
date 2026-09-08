import CompanionMark from './CompanionMark'
import Installations from './Installations'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, CircleHelp, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import './app-settings.css'

type AppState = {
  available: boolean
  version?: string
  launchAtLogin?: boolean
  loginNeedsApproval?: boolean
  updatesAvailable?: boolean
  automaticallyChecksForUpdates?: boolean
  automaticallyDownloadsUpdates?: boolean
}
type Action = 'launchAtLogin' | 'automaticallyChecksForUpdates' | 'automaticallyDownloadsUpdates' | 'checkForUpdates' | 'openLoginSettings' | 'about'

function Row({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="setting-row"><div><h3>{title}</h3><p>{description}</p></div><div className="setting-control">{children}</div></div>
}

export default function AppSettings() {
  const [state, setState] = useState<AppState | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [error, setError] = useState('')
  const [reachable, setReachable] = useState(false)
  const [loading, setLoading] = useState(true)
  const alive = useRef(false)
  const busy = useRef(false)
  const pollController = useRef<AbortController | null>(null)
  const mutationController = useRef<AbortController | null>(null)

  useEffect(() => {
    alive.current = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (!busy.current) {
        const controller = new AbortController()
        pollController.current = controller
        const timeout = setTimeout(() => controller.abort(), 5000)
        try {
          const response = await fetch('/api/app-settings', { signal: controller.signal, cache: 'no-store' })
          if (!response.ok) throw new Error('Could not load app settings. Retrying...')
          const next: AppState = await response.json()
          if (!disposed && !controller.signal.aborted) { setState(next); setReachable(true) }
        } catch {
          if (!disposed && !busy.current) setReachable(false)
        } finally { clearTimeout(timeout); if (!disposed) setLoading(false) }
      }
      if (!disposed) timer = setTimeout(() => void poll(), 3000)
    }
    void poll()
    return () => {
      disposed = true
      alive.current = false
      clearTimeout(timer)
      pollController.current?.abort()
      mutationController.current?.abort()
    }
  }, [])

  const perform = async (action: Action, value?: boolean) => {
    if (busy.current) return
    busy.current = true
    pollController.current?.abort()
    setPending(action)
    setError('')
    const controller = new AbortController()
    mutationController.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch('/api/app-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(value === undefined ? {} : { value }) }), signal: controller.signal,
      })
      const next = await response.json() as AppState & { error?: string }
      if (!response.ok || next.error) throw new Error(next.error || 'Could not change app settings. Please try again.')
      if (alive.current) { setState(next); setReachable(true) }
    } catch (cause) {
      if (alive.current) setError(controller.signal.aborted ? 'The app took too long to respond. Please try again.' : cause instanceof Error ? cause.message : 'Could not change app settings. Please try again.')
    } finally {
      clearTimeout(timeout)
      busy.current = false
      if (alive.current) setPending(null)
    }
  }
  const disabled = !state?.available || !reachable || pending !== null
  const updatesDisabled = disabled || !state?.updatesAvailable

  return <div className="app-settings page-content">
    {(!state || !reachable) && <p className="app-settings-notice" role="status">{loading ? 'Connecting to the Companion app...' : 'App settings are unreachable. Retrying automatically...'}</p>}
    {state && !state.available && <div className="information-note" role="status"><CircleHelp size={16}/><p>Open Companion for macOS to manage startup and software updates. These settings are available while the app is running.</p></div>}
    {error && <p className="source-message app-settings-error" role="alert">{error}</p>}
    <section className="panel" aria-labelledby="app-startup-title">
      <div className="panel-header"><div><h2 id="app-startup-title">Startup</h2><p>Keep your companion close from the moment you sign in.</p></div></div>
      <Row title="Launch at login" description="Start Companion automatically when you log in to your Mac."><Switch aria-label="Launch at login" checked={!!state?.launchAtLogin} disabled={disabled} onCheckedChange={value => void perform('launchAtLogin', value)}/></Row>
      {state?.loginNeedsApproval && <div className="app-settings-approval"><p>Allow Companion in macOS Login Items to finish enabling launch at login.</p><Button variant="outline" disabled={disabled} onClick={() => void perform('openLoginSettings')}>Open Login Items<ArrowUpRight size={14}/></Button></div>}
    </section>
    <section className="panel" aria-labelledby="app-updates-title">
      <div className="panel-header"><div><h2 id="app-updates-title">Software updates</h2><p>Stay up to date with the latest improvements.</p></div></div>
      <Row title="Automatically check for updates" description="Let Companion check for new versions in the background."><Switch aria-label="Automatically check for updates" checked={!!state?.automaticallyChecksForUpdates} disabled={updatesDisabled} onCheckedChange={value => void perform('automaticallyChecksForUpdates', value)}/></Row>
      <Row title="Automatically download updates" description="Download available updates so they are ready to install."><Switch aria-label="Automatically download updates" checked={!!state?.automaticallyDownloadsUpdates} disabled={updatesDisabled} onCheckedChange={value => void perform('automaticallyDownloadsUpdates', value)}/></Row>
      <Row title="Check for updates" description={state?.available && !state.updatesAvailable ? 'Software updates are unavailable in this local build.' : 'Check for a new version of Companion now.'}><Button variant="outline" disabled={updatesDisabled} onClick={() => void perform('checkForUpdates')}><RefreshCw size={14}/>{pending === 'checkForUpdates' ? 'Checking...' : 'Check now'}</Button></Row>
    </section>
    <Installations/>
    <section className="panel" aria-labelledby="app-about-title">
      <div className="app-settings-about"><CompanionMark/><div><h2 id="app-about-title">Companion</h2><p>{state?.version ? `Version ${state.version}` : 'Your little desktop companion.'}</p></div><Button variant="ghost" disabled={disabled} onClick={() => void perform('about')}>About<ArrowUpRight size={14}/></Button></div>
    </section>
  </div>
}
