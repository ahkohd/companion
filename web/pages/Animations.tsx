import { Check, ChevronDown, CircleHelp, Play, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import Face from '../components/face/Face'
import { Panel, Thumbnail } from '../components/page-ui'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import type { PageProps } from '../lib/studio'
import {
  animationName,
  animations,
  type Status,
  statusDescriptions,
  statusNames,
} from '../lib/studio'

const statusList: Status[] = ['working', 'blocked', 'done', 'idle', 'unknown', 'disconnected']

export default function Animations({
  snapshot: s,
  pending,
  save,
  audition,
  auditionId,
}: PageProps & { audition: (id: string | undefined) => void; auditionId: string | undefined }) {
  const [tab, setTab] = useState<'mappings' | 'library'>('mappings')
  const [search, setSearch] = useState('')
  const [mapping, setMapping] = useState<Status | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [dialogSearch, setDialogSearch] = useState('')

  const [auditionClock, setAuditionClock] = useState(() => ({
    changedAt: Date.now(),
    animationMs: performance.now(),
  }))

  const filtered = animations.filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))

  const openMapping = (state: Status) => {
    setMapping(state)
    setChoice(s.settings.mappings[state])
    setDialogSearch('')
    setAuditionClock({ changedAt: Date.now(), animationMs: performance.now() })
  }

  const choose = (id: string | null) => {
    setChoice(id)
    setAuditionClock({ changedAt: Date.now(), animationMs: performance.now() })
  }

  return (
    <>
      <div className="segmented-tabs" role="group" aria-label="Animation views">
        {(['mappings', 'library'] as const).map((id) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {id === 'mappings' ? 'Status mappings' : 'Animation library'}
            {id === 'library' && <span>{animations.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'mappings' ? (
        <>
          <Panel
            title="A face for every state"
            description="Your chosen animation plays automatically when a status changes."
          >
            {statusList.map((state) => (
              <div className="mapping-row" key={state}>
                <div className="mapping-info">
                  <h3>{statusNames[state]}</h3>
                  <p>{statusDescriptions[state]}</p>
                </div>
                <button
                  type="button"
                  className="mapping-choice"
                  onClick={() => openMapping(state)}
                  disabled={pending}
                >
                  <Thumbnail id={s.settings.mappings[state] ?? state} />
                  <span>{animationName(s.settings.mappings[state])}</span>
                  <ChevronDown size={14} />
                </button>
              </div>
            ))}
          </Panel>

          <div className="information-note">
            <CircleHelp size={16} />
            <p>
              Mappings change the expression. Your status and session title stay in place. Default
              idle gently falls asleep after 30 seconds.
            </p>
          </div>
          <Button
            variant="ghost"
            className="quiet-reset"
            disabled={pending || !Object.values(s.settings.mappings).some(Boolean)}
            onClick={() =>
              void save(
                { mappings: Object.fromEntries(statusList.map((id) => [id, null])) },
                'Default animations restored',
              )
            }
          >
            <RotateCcw size={14} />
            Restore default mappings
          </Button>
        </>
      ) : (
        <>
          <div className="library-toolbar">
            <div className="search-field">
              <Search size={16} />
              <Input
                aria-label="Search animations"
                placeholder="Find an expression"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="library-grid">
            {filtered.map((clip) => (
              <button
                type="button"
                key={clip.id}
                className={`animation-card ${auditionId === clip.id ? 'selected' : ''}`}
                onClick={() => audition(clip.id)}
                aria-label={`Preview ${clip.label}`}
                aria-pressed={auditionId === clip.id}
              >
                <Thumbnail id={clip.id} />
                <div>
                  <strong>{clip.label}</strong>
                  <small>{clip.group}</small>
                  <span className="animation-play">
                    {auditionId === clip.id ? <Check size={14} /> : <Play size={13} />}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {!filtered.length && (
            <div className="empty-state">
              <Search size={24} />
              <h3>No expressions found</h3>
              <p>Try another word.</p>
            </div>
          )}
          <p className="library-note">
            Choose an expression to preview it, then send it to your device or assign it in Status
            mappings.
          </p>
        </>
      )}
      <Dialog
        open={mapping !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMapping(null)
          }
        }}
      >
        <DialogContent className="mapping-dialog">
          <DialogHeader>
            <DialogTitle>
              When {mapping ? statusNames[mapping].toLowerCase() : ''}, show...
            </DialogTitle>
            <DialogDescription>
              Choose an animation for this status. Save when it feels right.
            </DialogDescription>
          </DialogHeader>

          <div className="mapping-audition">
            <div className="mapping-face device-preview">
              <div className="device-screen" dir="ltr">
                <Face
                  key={auditionClock.changedAt}
                  state={choice ?? mapping ?? 'idle'}
                  changedAt={auditionClock.changedAt}
                  animationMs={auditionClock.animationMs}
                  ageMs={0}
                  preview
                  reduced={s.settings.appearance.reducedMotion}
                />
              </div>
            </div>

            <div>
              <strong>{animationName(choice)}</strong>
              <p>Preview this expression before saving it.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setAuditionClock({ changedAt: Date.now(), animationMs: performance.now() })
                }
              >
                <RotateCcw size={12} />
                Replay
              </Button>
            </div>
          </div>
          <button
            type="button"
            className={`default-choice ${choice === null ? 'selected' : ''}`}
            onClick={() => choose(null)}
          >
            <RotateCcw size={17} />
            <span>
              <strong>Default</strong>
              <small>Use the companion's built-in expression</small>
            </span>
            {choice === null && <Check size={17} />}
          </button>
          <div className="search-field">
            <Search size={16} />
            <Input
              aria-label="Search mapping animations"
              placeholder="Search animations"
              value={dialogSearch}
              onChange={(e) => setDialogSearch(e.target.value)}
            />
          </div>

          <div className="dialog-library">
            {animations
              .filter((a) => a.label.toLowerCase().includes(dialogSearch.toLowerCase()))
              .map((clip) => (
                <button
                  type="button"
                  key={clip.id}
                  className={`dialog-animation ${choice === clip.id ? 'selected' : ''}`}
                  aria-pressed={choice === clip.id}
                  onClick={() => choose(clip.id)}
                >
                  <Thumbnail id={clip.id} />
                  <span>{clip.label}</span>
                  {choice === clip.id && <Check size={13} />}
                </button>
              ))}
          </div>

          <div className="dialog-actions">
            <span>{animationName(choice)}</span>
            <Button variant="outline" onClick={() => setMapping(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={async () => {
                if (
                  mapping &&
                  (await save(
                    { mappings: { [mapping]: choice } },
                    `${statusNames[mapping]} animation saved`,
                  ))
                ) {
                  setMapping(null)
                  audition(undefined)
                }
              }}
            >
              Save mapping
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
