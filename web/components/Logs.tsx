import { Copy, Download, FileText, Pause, Play, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './logs.css'

type Entry = { id: number; timestamp: string; level: 'info' | 'warn' | 'error'; message: string }

export default function Logs() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState('all')
  const [paused, setPaused] = useState(false)
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const viewport = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paused) {
      return
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()

    const update = async () => {
      try {
        const res = await fetch('/api/logs', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          cache: 'no-store',
        })

        if (!res.ok) {
          throw Error('Could not load logs')
        }

        const data = await res.json()

        if (!Array.isArray(data.entries)) {
          throw Error('Invalid log response')
        }

        if (!disposed) {
          setEntries(data.entries)
          setError('')
          setLoaded(true)
        }
      } catch {
        if (!disposed) {
          setError('Bridge unavailable. Showing the last received logs. Retrying automatically.')
        }
      }

      if (!disposed) {
        timer = setTimeout(update, 1500)
      }
    }

    void update()

    return () => {
      disposed = true
      controller.abort()
      clearTimeout(timer)
    }
  }, [paused])

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (level === 'all' || e.level === level) &&
          `${e.message} ${e.timestamp}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [entries, level, query],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies(filtered): Scroll when the visible entries change, including replacements at the same count.
  useEffect(() => {
    if (follow && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight
    }
  }, [filtered, follow])

  const text = () =>
    filtered.map((e) => `${e.timestamp} [${e.level.toUpperCase()}] ${e.message}`).join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text())
      toast.success('Logs copied')
    } catch {
      toast.error('Could not copy logs. Try downloading them.')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([`${text()}\n`], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `companion-${new Date().toISOString().replaceAll(':', '-')}.log`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="panel logs-panel" aria-label="Bridge logs">
      <div className="logs-toolbar">
        <div className="logs-search">
          <Search size={16} />
          <Input
            aria-label="Search logs"
            placeholder="Search logs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select aria-label="Log level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="all">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warnings</option>
          <option value="error">Errors</option>
        </select>
        <Button variant="outline" onClick={() => setPaused(!paused)} aria-pressed={paused}>
          {paused ? <Play size={14} /> : <Pause size={14} />} {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button variant="outline" disabled={!filtered.length} onClick={() => void copy()}>
          <Copy size={14} />
          Copy
        </Button>
        <Button variant="outline" disabled={!filtered.length} onClick={download}>
          <Download size={14} />
          Download
        </Button>
      </div>

      {error && (
        <p className="logs-error" role="status">
          {error}
        </p>
      )}

      <div
        className="logs-view"
        role="region"
        ref={viewport}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the log viewport.
        tabIndex={0}
        aria-label="Log entries"
        onScroll={(e) => {
          const el = e.currentTarget

          if (el.scrollHeight - el.clientHeight - el.scrollTop > 40) {
            setFollow(false)
          }
        }}
      >
        {filtered.length ? (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Level</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td>
                    <time dateTime={e.timestamp} title={e.timestamp}>
                      {new Date(e.timestamp).toLocaleTimeString([], { hour12: false })}
                    </time>
                  </td>
                  <td>
                    <span className={`log-level log-${e.level}`}>
                      {e.level === 'warn' ? 'warning' : e.level}
                    </span>
                  </td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="logs-empty">
            <FileText size={26} />
            <h2>
              {query || level !== 'all'
                ? 'No matching logs'
                : loaded
                  ? 'No events yet'
                  : 'Connecting to logs'}
            </h2>
            <p>
              {query || level !== 'all'
                ? 'Try a different search or level.'
                : 'Connection changes and bridge diagnostics will appear here.'}
            </p>
          </div>
        )}
      </div>

      <footer className="logs-footer">
        <span>
          <i className={paused || error ? '' : 'logs-live'} />
          {paused ? 'Paused' : error ? 'Reconnecting' : 'Live'}
          <span className="logs-count">
            {filtered.length} of {entries.length} events
          </span>
        </span>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow latest
        </label>
      </footer>
      <p className="logs-note">
        Latest 500 events from this bridge session. Copy and download include the current filter.
        The menu bar opens the local log file if the bridge is unavailable.
      </p>
    </section>
  )
}
