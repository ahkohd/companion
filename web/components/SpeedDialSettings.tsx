import { EmojiPicker } from 'frimousse'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  ExternalLink,
  File,
  Folder,
  Grid2X2,
  GripVertical,
  Headphones,
  Heart,
  ImagePlus,
  LayoutGrid,
  List,
  LoaderCircle,
  type LucideProps,
  Monitor,
  Moon,
  Music2,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Smile,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import { type ComponentType, type DragEvent, useCallback, useEffect, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SPEED_DIAL_MAX_SLOTS, speedDialPageSize } from '../../shared/speed-dial-layout.mjs'
import { colorHex, designFor } from '../lib/design'
import { reorderSpeedDialButtons } from '../lib/speed-dial-order'
import type {
  Action,
  Save,
  SpeedDialAction,
  SpeedDialActionType,
  SpeedDialButton,
  SpeedDialSettings as SpeedDialConfig,
  SpeedDialIcon,
  SpeedDialResult,
  StudioSnapshot,
} from '../lib/studio'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Switch } from './ui/switch'
import './speed-dial.css'

const builtins: { id: string; label: string; Icon: ComponentType<LucideProps> }[] = [
  { id: 'zap', label: 'Lightning', Icon: Zap },
  { id: 'terminal', label: 'Terminal', Icon: Terminal },
  { id: 'code', label: 'Code', Icon: Code2 },
  { id: 'folder', label: 'Folder', Icon: Folder },
  { id: 'globe', label: 'Website', Icon: ExternalLink },
  { id: 'monitor', label: 'Display', Icon: Monitor },
  { id: 'music', label: 'Music', Icon: Music2 },
  { id: 'headphones', label: 'Headphones', Icon: Headphones },
  { id: 'heart', label: 'Heart', Icon: Heart },
  { id: 'moon', label: 'Moon', Icon: Moon },
  { id: 'sparkles', label: 'Sparkles', Icon: Sparkles },
  { id: 'settings', label: 'Settings', Icon: Settings2 },
]

const actionTypes: {
  type: SpeedDialActionType
  label: string
  placeholder: string
  hint: string
  Icon: ComponentType<LucideProps>
}[] = [
  {
    type: 'app',
    label: 'Open app',
    placeholder: 'Safari',
    hint: 'App name or an absolute path to a .app.',
    Icon: Monitor,
  },

  {
    type: 'url',
    label: 'Open URL',
    placeholder: 'https://example.com',
    hint: 'A website or app URL, including its scheme.',
    Icon: ExternalLink,
  },

  {
    type: 'file',
    label: 'Open file',
    placeholder: '/Users/you/Documents',
    hint: 'An absolute path to a file or folder.',
    Icon: File,
  },

  {
    type: 'shortcut',
    label: 'Run Shortcut',
    placeholder: 'Start focus',
    hint: 'The exact name of a shortcut in the Shortcuts app.',
    Icon: WandSparkles,
  },

  {
    type: 'shell',
    label: 'Shell command',
    placeholder: "printf 'Hello from Companion\\n'",
    hint: 'Runs on this Mac. Each action waits for the previous one to finish.',
    Icon: Terminal,
  },
]

function cleanLabel(value: string, suffix = '') {
  let result = ''

  for (const char of Array.from(value).slice(0, 24 - Array.from(suffix).length)) {
    if (new TextEncoder().encode(result + char + suffix).length > 64) {
      break
    }

    result += char
  }

  return result + suffix
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export const speedDialIconUrl = (id: string) => `/api/speed-dial/icons/${id}.png`

const blankButton = (): SpeedDialButton => ({
  id: crypto.randomUUID(),
  label: '',
  enabled: true,
  color: null,
  icon: { kind: 'builtin', value: 'zap', assetId: '' },
  actions: [{ type: 'app', value: '' }],
})

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(Error('This image could not be read. Choose a PNG or SVG.'))
    image.src = url
  })
}

async function makeIcon(icon: Pick<SpeedDialIcon, 'kind' | 'value'>, file?: File): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const context = canvas.getContext('2d')

  if (!context) {
    throw Error('Your browser could not prepare this icon.')
  }

  if (icon.kind === 'emoji') {
    context.font = '76px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(icon.value, 48, 50, 88)
  } else {
    let blob: Blob

    if (icon.kind === 'builtin') {
      const Icon = builtins.find((item) => item.id === icon.value)?.Icon || Zap
      blob = new Blob(
        [renderToStaticMarkup(<Icon width={96} height={96} color="#8c8c8c" strokeWidth={1.65} />)],
        { type: 'image/svg+xml' },
      )
    } else {
      if (!file) {
        throw Error('Choose an image to upload.')
      }

      if (file.size > 2 * 1024 * 1024) {
        throw Error('Choose an image smaller than 2 MB.')
      }

      if (
        !/\.(png|svg)$/i.test(file.name) ||
        !['image/png', 'image/svg+xml', ''].includes(file.type)
      ) {
        throw Error('Choose a PNG or SVG image.')
      }

      blob = file
    }

    const url = URL.createObjectURL(blob)

    try {
      const image = await loadImage(url)

      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192
      ) {
        throw Error('Choose an image no larger than 8192 pixels on each side.')
      }

      const scale = 80 / Math.max(image.naturalWidth, image.naturalHeight)
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return canvas.toDataURL('image/png')
}

async function uploadIcon(dataUrl: string): Promise<string> {
  const response = await fetch('/api/speed-dial/icon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  })

  const result = await response.json()

  if (!response.ok) {
    throw Error(result.error || 'The icon could not be saved.')
  }

  if (!/^[a-f0-9]{64}$/.test(result.assetId)) {
    throw Error('The bridge returned an invalid icon.')
  }

  return result.assetId
}

function ButtonIcon({ button, size = 40 }: { button: SpeedDialButton; size?: number }) {
  return (
    <span
      className="sd-button-icon"
      style={{
        width: size,
        height: size,
        background: button.color === null ? undefined : colorHex(button.color),
      }}
    >
      {button.icon.assetId ? (
        <img
          src={speedDialIconUrl(button.icon.assetId)}
          width={size * 0.65}
          height={size * 0.65}
          alt=""
        />
      ) : (
        <Zap size={size * 0.45} />
      )}
    </span>
  )
}

function RunResult({ result }: { result?: SpeedDialResult }) {
  if (!result) {
    return null
  }

  return (
    <div className={`sd-result sd-result-${result.status}`} role="status">
      <div>
        {result.status === 'running' ? (
          <LoaderCircle size={14} className="sd-spin" />
        ) : result.status === 'success' ? (
          <Check size={14} />
        ) : (
          <X size={14} />
        )}
        <span>
          {result.status === 'running'
            ? 'Running actions'
            : result.status === 'success'
              ? 'Actions completed'
              : result.error || 'The action could not finish.'}
        </span>
      </div>

      {result.output && (
        <details>
          <summary>View output</summary>
          <pre>{result.output}</pre>
        </details>
      )}
    </div>
  )
}

function IconPicker({
  icon,
  onChange,
  busy,
}: {
  icon: SpeedDialIcon
  onChange: (icon: Pick<SpeedDialIcon, 'kind' | 'value'>, file?: File) => void
  busy: boolean
}) {
  const [tab, setTab] = useState<SpeedDialIcon['kind']>(icon.kind)

  const upload = useRef<HTMLInputElement>(null)

  return (
    <div className="sd-icon-picker">
      <div className="sd-segments" role="group" aria-label="Icon source">
        {(
          [
            { id: 'emoji', label: 'Emoji', Icon: Smile },
            { id: 'builtin', label: 'Icons', Icon: Grid2X2 },
            { id: 'image', label: 'Upload', Icon: Upload },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'emoji' ? (
        <EmojiPicker.Root
          className="sd-emoji-picker"
          emojibaseUrl="/emoji-data"
          columns={8}
          onEmojiSelect={({ emoji }) => onChange({ kind: 'emoji', value: emoji })}
        >
          <div className="sd-emoji-search">
            <Search size={14} />
            <EmojiPicker.Search placeholder="Search emoji" aria-label="Search emoji" />
            <EmojiPicker.SkinToneSelector aria-label="Change skin tone" />
          </div>
          <EmojiPicker.Viewport>
            <EmojiPicker.Loading>Loading emoji...</EmojiPicker.Loading>
            <EmojiPicker.Empty>No emoji found.</EmojiPicker.Empty>
            <EmojiPicker.List
              components={{
                CategoryHeader: ({ category, ...props }) => <div {...props}>{category.label}</div>,

                Emoji: ({ emoji, ...props }) => (
                  <button {...props} type="button" disabled={busy}>
                    {emoji.emoji}
                  </button>
                ),
              }}
            />
          </EmojiPicker.Viewport>
        </EmojiPicker.Root>
      ) : tab === 'builtin' ? (
        <div className="sd-builtin-grid" role="group" aria-label="Built-in icons">
          {builtins.map(({ id, label, Icon }) => (
            <button
              type="button"
              key={id}
              title={label}
              aria-label={label}
              aria-pressed={icon.kind === 'builtin' && icon.value === id}
              disabled={busy}
              onClick={() => onChange({ kind: 'builtin', value: id })}
            >
              <Icon size={24} />
            </button>
          ))}
        </div>
      ) : (
        <div className="sd-upload">
          <ImagePlus size={26} />
          <p>Your own icon</p>
          <span>
            PNG or SVG, up to 2 MB.
            <br />
            Transparency is preserved.
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            <Upload size={14} />
            Choose image
          </Button>
          <input
            ref={upload}
            type="file"
            hidden
            accept="image/png,image/svg+xml,.png,.svg"
            onChange={(event) => {
              const file = event.target.files?.[0]

              if (file) {
                onChange({ kind: 'image', value: file.name }, file)
              }

              event.target.value = ''
            }}
          />
        </div>
      )}
    </div>
  )
}

function ButtonEditor({
  initial,
  saved,
  revision,
  pending,
  onSave,
  onClose,
  action,
  result,
}: {
  initial: SpeedDialButton
  saved?: SpeedDialButton
  revision: number
  pending: boolean
  onSave: (button: SpeedDialButton) => Promise<boolean>
  onClose: () => void
  action: Action
  result?: SpeedDialResult
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial))
  const [iconBusy, setIconBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const iconRequest = useRef(0)
  const mounted = useRef(true)

  const dirty = !saved || !equal(draft, saved)

  const valid =
    !!draft.label.trim() &&
    !!draft.icon.assetId &&
    draft.actions.length > 0 &&
    draft.actions.every((item) => !!item.value.trim())

  const busy = pending || saving || iconBusy

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      iconRequest.current++
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: Prepare the initial icon once per editor; rerenders must not replace the user's selection.
  useEffect(() => {
    if (!initial.icon.assetId) {
      void selectIcon(initial.icon)
    }
  }, [])

  async function selectIcon(icon: Pick<SpeedDialIcon, 'kind' | 'value'>, file?: File) {
    const request = ++iconRequest.current
    setIconBusy(true)
    setError('')

    try {
      const assetId = await uploadIcon(await makeIcon(icon, file))

      if (mounted.current && request === iconRequest.current) {
        setDraft((value) => ({ ...value, icon: { ...icon, assetId } }))
      }
    } catch (error) {
      if (mounted.current && request === iconRequest.current) {
        setError(error instanceof Error ? error.message : 'Could not prepare this icon.')
      }
    } finally {
      if (mounted.current && request === iconRequest.current) {
        setIconBusy(false)
      }
    }
  }

  function updateAction(index: number, patch: Partial<SpeedDialAction>) {
    setDraft((value) => ({
      ...value,
      actions: value.actions.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }))
  }

  function moveAction(index: number, direction: number) {
    setDraft((value) => {
      const actions = [...value.actions]
      ;[actions[index], actions[index + direction]] = [actions[index + direction], actions[index]]

      return { ...value, actions }
    })
  }

  async function save() {
    if (!valid || busy) {
      return
    }

    setSaving(true)
    setError('')

    try {
      if (!(await onSave({ ...draft, label: draft.label.trim() }))) {
        setError('Your changes are still here. Try saving again.')
      } else {
        setDraft((value) => ({ ...value, label: value.label.trim() }))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="sd-editor" initialFocus={() => document.getElementById('sd-label')}>
      <DialogHeader>
        <DialogTitle>{saved ? 'Edit button' : 'New button'}</DialogTitle>
        <DialogDescription>Choose its look, then add the actions it should run.</DialogDescription>
      </DialogHeader>

      <div className="sd-editor-scroll">
        <div className="sd-editor-identity">
          <div className="sd-icon-preview">
            <ButtonIcon button={draft} size={76} />
            {iconBusy && (
              <span className="sd-icon-loading">
                <LoaderCircle size={19} className="sd-spin" />
              </span>
            )}
          </div>

          <div className="sd-label-field">
            <label htmlFor="sd-label">Button label</label>
            <Input
              id="sd-label"
              autoComplete="off"
              value={draft.label}
              maxLength={48}
              placeholder="Start focus"
              onChange={(event) =>
                setDraft((value) => ({ ...value, label: cleanLabel(event.target.value) }))
              }
            />
            <span>{Array.from(draft.label).length}/24</span>
          </div>
        </div>

        <div className="sd-editor-appearance">
          <IconPicker
            icon={draft.icon}
            onChange={(icon, file) => void selectIcon(icon, file)}
            busy={iconBusy}
          />
          <div className="sd-button-options">
            <label>
              Button colour
              <div className="sd-colour-control">
                <input
                  type="color"
                  aria-label="Button colour"
                  value={colorHex(draft.color ?? 0x333333)}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      color: parseInt(event.target.value.slice(1), 16),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={draft.color === null}
                  onClick={() => setDraft((value) => ({ ...value, color: null }))}
                >
                  Use theme
                </Button>
              </div>
              <span>{draft.color === null ? 'Follows device colours' : 'Custom background'}</span>
            </label>
            <label className="sd-enable">
              Enabled
              <Switch
                checked={draft.enabled}
                aria-label="Enable this button"
                onCheckedChange={(enabled) => setDraft((value) => ({ ...value, enabled }))}
              />
            </label>
            <p>Disabled buttons stay in your collection and do not appear on the device.</p>
          </div>
        </div>

        <section className="sd-actions-editor">
          <div className="sd-section-heading">
            <div>
              <h3>Actions</h3>
              <p>Run in order. The sequence stops if an action fails.</p>
            </div>
            <span>{draft.actions.length}/8</span>
          </div>

          <div className="sd-action-list">
            {draft.actions.map((item, index) => {
              const info = actionTypes.find((option) => option.type === item.type)!

              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: Actions have no IDs; controlled fields follow their numbered slots, including duplicate actions.
                <div className="sd-action-row" key={index}>
                  <span className="sd-action-number">{index + 1}</span>
                  <div className="sd-action-fields">
                    <Select
                      value={item.type}
                      disabled={saving}
                      onValueChange={(type) => {
                        if (type && type !== item.type) {
                          updateAction(index, { type: type as SpeedDialActionType, value: '' })
                        }
                      }}
                    >
                      <SelectTrigger
                        className="sd-action-type"
                        aria-label={`Action ${index + 1} type`}
                      >
                        <SelectValue>
                          <info.Icon size={14} />
                          {info.label}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent align="start" alignItemWithTrigger={false}>
                        {actionTypes.map((option) => (
                          <SelectItem key={option.type} value={option.type}>
                            <option.Icon size={14} />
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {item.type === 'shell' ? (
                      <textarea
                        aria-label={`Action ${index + 1} command`}
                        value={item.value}
                        maxLength={4096}
                        spellCheck={false}
                        rows={2}
                        placeholder={info.placeholder}
                        onChange={(event) => updateAction(index, { value: event.target.value })}
                      />
                    ) : (
                      <Input
                        aria-label={`Action ${index + 1} value`}
                        value={item.value}
                        maxLength={4096}
                        placeholder={info.placeholder}
                        onChange={(event) => updateAction(index, { value: event.target.value })}
                      />
                    )}
                    <p>{info.hint}</p>
                  </div>

                  <div className="sd-action-controls">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move action ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveAction(index, -1)}
                    >
                      <ArrowUp size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move action ${index + 1} down`}
                      disabled={index === draft.actions.length - 1}
                      onClick={() => moveAction(index, 1)}
                    >
                      <ArrowDown size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove action ${index + 1}`}
                      disabled={draft.actions.length === 1}
                      onClick={() =>
                        setDraft((value) => ({
                          ...value,
                          actions: value.actions.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={draft.actions.length >= 8}
            onClick={() =>
              setDraft((value) => ({
                ...value,
                actions: [...value.actions, { type: 'app', value: '' }],
              }))
            }
          >
            <Plus size={14} />
            Add action
          </Button>
        </section>
        <RunResult result={result} />
        {error && (
          <p className="sd-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="sd-editor-footer">
        <div>
          <Button
            variant="outline"
            disabled={busy || dirty || !saved?.enabled || result?.status === 'running'}
            title={dirty ? 'Save this button before testing it' : undefined}
            onClick={() => void action('speed-dial/run', { id: draft.id, revision })}
          >
            {result?.status === 'running' ? (
              <LoaderCircle size={14} className="sd-spin" />
            ) : (
              <Play size={14} />
            )}
            Test button
          </Button>
          <span>{dirty ? 'Save before testing' : 'Runs on this Mac'}</span>
        </div>
        <Button variant="ghost" disabled={saving} onClick={onClose}>
          Close
        </Button>
        <Button disabled={busy || !valid || !dirty} onClick={() => void save()}>
          {saving || iconBusy ? (
            <LoaderCircle size={14} className="sd-spin" />
          ) : (
            <Check size={14} />
          )}
          Save button
        </Button>
      </div>
    </DialogContent>
  )
}

export default function SpeedDialSettings({
  snapshot: s,
  pending,
  save,
  action,
}: {
  snapshot: StudioSnapshot
  pending: boolean
  save: Save
  action: Action
}) {
  const config = s.settings.modules.speedDial

  const [editing, setEditing] = useState<SpeedDialButton | null>(null)
  const [mutating, setMutating] = useState(false)

  const configRef = useRef(config)
  configRef.current = config

  const busy = pending || mutating

  const drag = useRef<{ id: string; order: string } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null)

  const order = config.buttons.map((button) => button.id).join(',')

  const endDrag = useCallback(() => {
    drag.current = null
    setDragging(null)
    setDropTarget(null)
  }, [])

  useEffect(() => {
    if (busy || drag.current?.order !== order) {
      endDrag()
    }
  }, [busy, order, endDrag])

  function startDrag(event: DragEvent<HTMLElement>, id: string) {
    if (busy) {
      event.preventDefault()
      return
    }

    drag.current = { id, order }
    setDragging(id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)

    const row = event.currentTarget.closest('.sd-button-row') as HTMLElement
    const bounds = row.getBoundingClientRect()
    event.dataTransfer.setDragImage(row, event.clientX - bounds.left, event.clientY - bounds.top)
  }

  function targetAt(event: DragEvent<HTMLDivElement>) {
    const rows = Array.from(event.currentTarget.children) as HTMLElement[]

    const row =
      rows.find((row) => event.clientY < row.getBoundingClientRect().bottom) ?? rows.at(-1)

    if (!row) {
      return null
    }

    const bounds = row.getBoundingClientRect()

    return { id: row.dataset.buttonId!, after: event.clientY >= bounds.top + bounds.height / 2 }
  }

  function overList(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()

    if (!drag.current || busy) {
      event.dataTransfer.dropEffect = 'none'
      return
    }

    event.dataTransfer.dropEffect = 'move'
    const target = targetAt(event)

    if (!target || target.id === drag.current.id) {
      setDropTarget(null)
      return
    }

    setDropTarget((current) =>
      current?.id === target.id && current.after === target.after ? current : target,
    )
  }

  function dropList(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const source = drag.current
    endDrag()

    const current = configRef.current.buttons

    if (!source || busy || source.order !== current.map((button) => button.id).join(',')) {
      return
    }

    const target = targetAt(event)

    if (!target) {
      return
    }

    const buttons = reorderSpeedDialButtons(current, source.id, target.id, target.after)

    if (buttons !== current) {
      void update({ buttons }, 'Button order saved')
    }
  }

  async function update(patch: Partial<SpeedDialConfig>, message = 'Speed Dial saved') {
    if (busy) {
      return false
    }

    setMutating(true)

    try {
      return await save({ modules: { speedDial: { ...configRef.current, ...patch } } }, message)
    } finally {
      setMutating(false)
    }
  }

  function move(index: number, direction: number) {
    const buttons = [...config.buttons]
    ;[buttons[index], buttons[index + direction]] = [buttons[index + direction], buttons[index]]
    void update({ buttons }, 'Button order saved')
  }

  const pageSize = config.layout === 'grid' ? config.gridSize : config.listRows
  const screenShape = s.device.profile?.display.shape ?? 'round'

  const automaticSize = speedDialPageSize(
    { ...config, layout: 'grid', gridSize: 0, screenShape },
    designFor(s.settings.design, 'speedDial'),
  )

  const pageSizeLabel =
    pageSize === 0 ? `Automatic (${automaticSize} buttons)` : `${pageSize} buttons`

  return (
    <div className="sd-settings">
      <div className="sd-layout-settings">
        <div>
          <span className="sd-layout-label">Layout</span>
          <div className="sd-segments" role="group" aria-label="Speed Dial layout">
            <button
              type="button"
              aria-pressed={config.layout === 'grid'}
              disabled={busy}
              onClick={() => void update({ layout: 'grid' })}
            >
              <LayoutGrid size={15} />
              Grid
            </button>
            <button
              type="button"
              aria-pressed={config.layout === 'list'}
              disabled={busy}
              onClick={() => void update({ layout: 'list' })}
            >
              <List size={15} />
              List
            </button>
          </div>
        </div>

        <div className="sd-page-size">
          <label htmlFor="sd-page-size">Buttons per page</label>
          <Select
            value={pageSize}
            disabled={busy}
            onValueChange={(count) => {
              if (count !== null && count !== pageSize) {
                void update(
                  config.layout === 'grid'
                    ? { gridSize: count as 0 | 4 | 6 }
                    : { listRows: count as 3 | 4 },
                )
              }
            }}
          >
            <SelectTrigger id="sd-page-size" aria-label="Speed Dial buttons per page">
              <SelectValue>{pageSizeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {config.layout === 'grid' && (
                <SelectItem value={0}>Automatic ({automaticSize} buttons)</SelectItem>
              )}

              {(config.layout === 'grid' ? [4, 6] : [3, 4]).map((count) => (
                <SelectItem value={count} key={count}>
                  {count} buttons
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="sd-label-toggle">
          Show labels
          <Switch
            checked={config.showLabels}
            disabled={busy || config.layout === 'list'}
            aria-label="Show Speed Dial labels"
            onCheckedChange={(showLabels) => void update({ showLabels })}
          />
        </label>
        {config.layout === 'grid' && (
          <p className="sd-layout-hint">
            Automatic uses{' '}
            {screenShape === 'round'
              ? 'staggered rows on your round screen'
              : 'straight rows on your rectangular screen'}
            , with up to {SPEED_DIAL_MAX_SLOTS} buttons per page. Button size and labels determine
            how many fit.
          </p>
        )}
      </div>

      <div className="sd-section-heading">
        <div>
          <h3>Your buttons</h3>
          <p>
            {config.buttons.length
              ? `${config.buttons.filter((button) => button.enabled).length} enabled. Swipe up or down on the device to change pages.`
              : 'Open apps, websites and files, or run a sequence of actions.'}
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy || config.buttons.length >= 48}
          onClick={() => setEditing(blankButton())}
        >
          <Plus size={14} />
          Add button
        </Button>
      </div>

      {!config.buttons.length ? (
        <div className="sd-empty">
          <span>
            <LayoutGrid size={25} />
          </span>
          <h3>Your everyday actions, a tap away</h3>
          <p>
            Create your first button with an emoji,
            <br />
            an icon or an image of your own.
          </p>
          <Button variant="outline" disabled={busy} onClick={() => setEditing(blankButton())}>
            <Plus size={14} />
            Create a button
          </Button>
        </div>
      ) : (
        <div
          className="sd-button-list"
          role="group"
          aria-label="Speed Dial buttons"
          onDragOver={overList}
          onDrop={dropList}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropTarget(null)
            }
          }}
        >
          {config.buttons.map((button, index) => {
            const result = s.modules.speedDial?.results[button.id]

            return (
              <div
                className="sd-button-row"
                key={button.id}
                data-button-id={button.id}
                data-disabled={!button.enabled}
                data-dragging={dragging === button.id}
                data-drop={
                  dropTarget?.id === button.id ? (dropTarget.after ? 'after' : 'before') : undefined
                }
              >
                <span
                  className="sd-drag-handle"
                  draggable={!busy}
                  aria-hidden="true"
                  title="Drag to reorder"
                  onDragStart={(event) => startDrag(event, button.id)}
                  onDragEnd={endDrag}
                >
                  <GripVertical size={15} />
                </span>
                <button
                  type="button"
                  className="sd-edit-button"
                  disabled={busy}
                  onClick={() => setEditing(structuredClone(button))}
                >
                  <ButtonIcon button={button} />
                  <span>
                    <strong>{button.label}</strong>
                    <small>
                      {button.enabled
                        ? `${button.actions.length} ${button.actions.length === 1 ? 'action' : 'actions'}`
                        : 'Disabled'}

                      {result?.status === 'running'
                        ? ' - Running'
                        : result?.status === 'error'
                          ? ' - Needs attention'
                          : ''}
                    </small>
                  </span>
                </button>
                <div className="sd-row-controls">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${button.label} up`}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${button.label} down`}
                    disabled={busy || index === config.buttons.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${button.label}`}
                    title={`Edit ${button.label}`}
                    disabled={busy}
                    onClick={() => setEditing(structuredClone(button))}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Duplicate ${button.label}`}
                    disabled={busy || config.buttons.length >= 48}
                    onClick={() => {
                      const buttons = [...config.buttons]
                      buttons.splice(index + 1, 0, {
                        ...structuredClone(button),
                        id: crypto.randomUUID(),
                        label: cleanLabel(button.label, ' copy'),
                      })
                      void update({ buttons }, 'Button duplicated')
                    }}
                  >
                    <Copy size={13} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${button.label}`}
                    disabled={busy}
                    onClick={() =>
                      void update(
                        { buttons: config.buttons.filter((item) => item.id !== button.id) },
                        'Button deleted',
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {config.buttons.length >= 48 && (
        <p className="sd-note">Your collection is full. Remove a button to add another.</p>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null)
          }
        }}
      >
        {editing && (
          <ButtonEditor
            key={editing.id}
            initial={editing}
            revision={s.settingsRevision}
            saved={config.buttons.find((button) => button.id === editing.id)}
            pending={busy}
            action={action}
            result={s.modules.speedDial?.results[editing.id]}
            onClose={() => setEditing(null)}
            onSave={async (button) => {
              const current = configRef.current.buttons

              return update(
                {
                  buttons: current.some((item) => item.id === button.id)
                    ? current.map((item) => (item.id === button.id ? button : item))
                    : [...current, button],
                },
                'Button saved',
              )
            }}
          />
        )}
      </Dialog>
    </div>
  )
}
