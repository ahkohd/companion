import { useEffect, useRef, useState } from 'react'
import { Check, Download, RefreshCw, Terminal } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './installations.css'

type Status = 'installed' | 'missing' | 'outdated' | 'modified' | 'conflict'
type Installation = { status: Status; path: string }
type Snapshot = {
  cli: Installation & { onPath: boolean }
  skills: { directory: string; items: (Installation & { name: string; description: string })[] }
}
type Action = 'cli.install' | 'cli.uninstall' | 'skills.directory' | 'skills.install' | 'skills.uninstall' | 'skills.installAll'
const labels: Record<Status, string> = { installed: 'Installed', missing: 'Not installed', outdated: 'Update available', modified: 'Modified locally', conflict: 'Existing files' }

function StatusLabel({ status }: { status: Status }) {
  return <span className="installation-status">{status === 'installed' && <Check size={12}/>} {labels[status]}</span>
}

export default function Installations() {
  const [state, setState] = useState<Snapshot | null>(null)
  const [directory, setDirectory] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [reachable, setReachable] = useState(false)
  const alive = useRef(false)
  const busy = useRef(false)
  const dirty = useRef(false)
  const pollController = useRef<AbortController | null>(null)
  const actionController = useRef<AbortController | null>(null)

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
          const response = await fetch('/api/installations', { signal: controller.signal, cache: 'no-store' })
          if (!response.ok) throw new Error('Could not load installations.')
          const next: Snapshot = await response.json()
          if (!disposed && !controller.signal.aborted) {
            setState(next)
            setReachable(true)
            if (!dirty.current) setDirectory(next.skills.directory)
          }
        } catch {
          if (!disposed && !busy.current && controller.signal.reason !== 'installation-action') setReachable(false)
        } finally { clearTimeout(timeout) }
      }
      if (!disposed) timer = setTimeout(() => void poll(), 5000)
    }
    void poll()
    return () => {
      disposed = true
      alive.current = false
      clearTimeout(timer)
      pollController.current?.abort()
      actionController.current?.abort()
    }
  }, [])

  const perform = async (action: Action, name?: string) => {
    if (busy.current) return
    busy.current = true
    pollController.current?.abort('installation-action')
    // Fast local operations should finish without flashing a busy state.
    const pendingTimer = setTimeout(() => {
      if (alive.current) setPending(`${action}:${name || ''}`)
    }, 180)
    setError('')
    const controller = new AbortController()
    actionController.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const response = await fetch('/api/installations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action, ...(name ? { name } : {}), ...(action === 'skills.directory' ? { directory: directory.trim() } : {}) }),
      })
      const next = await response.json() as Snapshot & { error?: string }
      if (!response.ok || next.error) throw new Error(next.error || 'Could not change this installation.')
      if (alive.current) {
        setState(next)
        setReachable(true)
        if (action === 'skills.directory') dirty.current = false
        if (!dirty.current) setDirectory(next.skills.directory)
      }
    } catch (cause) {
      if (alive.current) setError(controller.signal.aborted ? 'The operation took too long. Check the installation status before trying again.' : cause instanceof Error ? cause.message : 'Could not change this installation.')
    } finally {
      clearTimeout(timeout)
      clearTimeout(pendingTimer)
      busy.current = false
      if (alive.current) setPending('')
    }
  }

  const disabled = !!pending || !reachable
  const controls = (item: Installation, scope: 'cli' | 'skills', name?: string) => {
    const install = `${scope}.install` as Action
    const uninstall = `${scope}.uninstall` as Action
    const working = pending === `${install}:${name || ''}` || pending === `${uninstall}:${name || ''}`
    return <div className="installation-actions">
      {item.status === 'missing' && <Button variant="outline" disabled={disabled} onClick={() => void perform(install, name)}><Download size={14}/>{working ? 'Installing...' : 'Install'}</Button>}
      {item.status === 'outdated' && <Button variant="outline" disabled={disabled} onClick={() => void perform(install, name)}><RefreshCw size={14}/>{pending === `${install}:${name || ''}` ? 'Updating...' : 'Update'}</Button>}
      {(item.status === 'installed' || item.status === 'outdated') && <Button variant="ghost" disabled={disabled} onClick={() => void perform(uninstall, name)}>{pending === `${uninstall}:${name || ''}` ? 'Uninstalling...' : 'Uninstall'}</Button>}
    </div>
  }

  return <div className="installations">
    <section className="panel" aria-labelledby="cli-settings-title">
      <div className="panel-header"><div><h2 id="cli-settings-title">Command line</h2><p>Use Companion from your terminal and agents.</p></div></div>
      <div className="installation-row"><div className="installation-copy"><div className="installation-heading"><h3><Terminal size={15}/>Companion CLI</h3>{state && <StatusLabel status={state.cli.status}/>}</div><p>Send attention requests and manage agent skills.</p>{state && <code className="installation-path">{state.cli.path}</code>}</div>{state && controls(state.cli, 'cli')}</div>
      {state && (state.cli.status === 'modified' || state.cli.status === 'conflict') && <p className="installation-note">This path contains files Companion cannot safely replace. Move them to a backup location before installing.</p>}
      {state?.cli.status === 'installed' && !state.cli.onPath && <p className="installation-note">The CLI is installed, but this app's PATH cannot find it or finds another <code>companion</code> first. If needed, put the directory shown above first in your shell's PATH or use the full path.</p>}
      {!reachable && <p className="installation-note" role="status">{state ? 'Installation status is unavailable. Retrying automatically...' : 'Connecting to local installation settings...'}</p>}
    </section>
    <section className="panel" aria-labelledby="skills-settings-title">
      <div className="panel-header"><div><h2 id="skills-settings-title">Agent skills</h2><p>Give your agents instructions for working with Companion.</p></div>{state && state.skills.items.length > 1 && <Button variant="outline" disabled={disabled || !state.skills.items.some(item => item.status === 'missing' || item.status === 'outdated')} onClick={() => void perform('skills.installAll')}>{pending === 'skills.installAll:' ? 'Installing...' : 'Install all'}</Button>}</div>
      <form className="installation-directory" onSubmit={event => { event.preventDefault(); void perform('skills.directory') }}>
        <label htmlFor="skills-directory">Skills directory</label>
        <div><Input id="skills-directory" value={directory} placeholder="~/.agents/skills" disabled={disabled} onChange={event => { dirty.current = true; setDirectory(event.target.value) }}/><Button type="submit" variant="outline" disabled={disabled || !directory.trim() || directory === state?.skills.directory}>{pending === 'skills.directory:' ? 'Saving...' : 'Save'}</Button></div>
        <p>Choose where agents find your skills. Changing this path does not move existing installations.</p>
      </form>
      {state?.skills.items.map(item => <div className="installation-row" key={item.name}><div className="installation-copy"><div className="installation-heading"><h3>{item.name}</h3><StatusLabel status={item.status}/></div><p>{item.description}</p><code className="installation-path">{item.path}</code>{(item.status === 'modified' || item.status === 'conflict') && <p className="installation-conflict">Your existing files are preserved. Move them to a backup location to install the bundled skill.</p>}</div>{controls(item, 'skills', item.name)}</div>)}
      <p className="installation-note">Skills are bundled with Companion and can be installed offline. Locally modified files are preserved.</p>
    </section>
    {error && <p className="source-message app-settings-error" role="alert">{error}</p>}
  </div>
}
