// Deterministic offline capture of the upstream Grok Bot renderer.
//
// Loads web/vendor/grok-bot/upstream-renderer.tsx (unmodified on disk) into an
// isolated vm context with fake React hooks, fake JSX, a fake SVG DOM, a
// controlled clock, and seeded Math.random. The original requestAnimationFrame
// loop runs at exactly 60 Hz. Snapshots are plain serialisable trees.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const UPSTREAM_PATH = path.resolve(HERE, '../../web/vendor/grok-bot/upstream-renderer.tsx')
export const SVG_NS = 'http://www.w3.org/2000/svg'
export const FRAME_SECONDS = 1 / 60
export const ACTION_TRIGGER_SECONDS = 0.14
export const DEFAULT_SEED = 0x6b726f6b
export const DEFAULT_SIZE = 340
// Suggested values for the CSS variables the snapshots keep as strings.
export const DEFAULT_CSS_VARS = Object.freeze({ '--fg': '#00e5ff', '--bg': '#000000', '--gb-badge': '#1d9bf0' })

// Load-time source edits. Each anchor must match exactly once; the checked-in
// upstream file is never modified. The last edit is the only instrumentation:
// it adds the internal hr(kind) spin trigger to the B.current handle object.
const PATCHES = [
  ['import * as S from "react";\n', ''],
  ['import { jsx, jsxs } from "react/jsx-runtime";\n', ''],
  ['\nexport const OfficialGrokBotRenderer = $_t;', '\n__exports.OfficialGrokBotRenderer = $_t;'],
  ['\nexport const OFFICIAL_GROK_SHAPES = Object.freeze(Object.keys(Jo));',
    '\n__exports.OFFICIAL_GROK_SHAPES = Object.freeze(Object.keys(Jo));\n__exports.STATE_NAMES = Object.freeze(Object.keys(g1e));'],
  ['return B.current = { spin: (ze = 1) => pn(ze), bounce: () => ai(), burst: () => {',
    'return B.current = { spinKind: hr, clickDouble: () => { Qt = true; pn(2) }, clickBurst: () => { pn(1); Hn.burst(16, 0.95, 0.3) }, spin: (ze = 1) => pn(ze), bounce: () => ai(), burst: () => {'],
]

const ACTIONS = {
  'spin': (h) => h.spin(1),
  'double-spin': (h) => h.clickDouble(),
  'spin-bounce': (h) => h.spinKind('spinBounce'),
  'spin-dizzy': (h) => h.spinKind('spinDizzy'),
  'spin-wild': (h) => h.spinKind('spinWild'),
  'bounce': (h) => h.bounce(),
  'burst': (h) => h.burst(),
  'spin-burst': (h) => h.clickBurst(),
}
export const GROK_ACTIONS = Object.freeze(Object.keys(ACTIONS))

function patchSource(text) {
  for (const [from, to] of PATCHES) {
    const at = text.indexOf(from)
    if (at < 0 || text.indexOf(from, at + 1) >= 0) throw new Error(`upstream anchor must match exactly once: ${JSON.stringify(from.slice(0, 70))}`)
    text = text.slice(0, at) + to + text.slice(at + from.length)
  }
  return text
}

let compiled = null
function scripts() {
  if (compiled) return compiled
  const text = patchSource(fs.readFileSync(UPSTREAM_PATH, 'utf8'))
  compiled = {
    module: new vm.Script(`(function (S, jsx, jsxs, __exports) {\n"use strict";\n${text}\n})`, { filename: 'upstream-renderer.tsx', lineOffset: -2 }),
    // mulberry32, installed on the context's own Math so the host is untouched.
    random: new vm.Script(`(function (seed) {
      let s = seed >>> 0;
      Math.random = function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })`, { filename: 'seeded-random.js' }),
  }
  return compiled
}

function strictProxy(label, api) {
  return new Proxy(api, {
    get(target, key) {
      if (typeof key === 'symbol') return undefined
      if (Object.hasOwn(target, key)) return target[key]
      throw new Error(`${label}: unsupported property "${String(key)}"`)
    },
    set(target, key) { throw new Error(`${label}: assignment to "${String(key)}" is unsupported`) },
  })
}

// React prop names that map to different SVG attribute names.
const ATTR_RENAME = {
  className: 'class', clipPath: 'clip-path', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin', strokeDasharray: 'stroke-dasharray', strokeDashoffset: 'stroke-dashoffset',
  stopColor: 'stop-color', stopOpacity: 'stop-opacity', fillOpacity: 'fill-opacity', fillRule: 'fill-rule', clipRule: 'clip-rule',
}
const ATTR_CAMEL_OK = new Set(['viewBox', 'gradientUnits', 'gradientTransform', 'preserveAspectRatio', 'spreadMethod'])
// React style numbers stay unitless for these; others get "px".
const STYLE_UNITLESS = new Set(['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'lineHeight', 'fontWeight', 'zoom',
  'fillOpacity', 'floodOpacity', 'stopOpacity', 'strokeDasharray', 'strokeDashoffset', 'strokeMiterlimit', 'strokeOpacity', 'strokeWidth'])

const cssName = (k) => k.startsWith('Webkit') || k.startsWith('Moz') || k.startsWith('ms')
  ? '-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^-/, '')
  : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

function attrName(k) {
  if (ATTR_RENAME[k]) return ATTR_RENAME[k]
  if (/[A-Z]/.test(k) && !ATTR_CAMEL_OK.has(k)) throw new Error(`fake JSX: unknown camelCase attribute "${k}"`)
  return k
}

class FakeElement {
  constructor(tag, session) {
    this.tag = tag
    this.attributes = {}
    this.style = {}
    this.children = []
    this.parent = null
    this.session = session
    const el = this
    this.proxy = strictProxy(`fake DOM <${tag}>`, {
      get tagName() { return tag },
      style: this.style,
      setAttribute(name, value) { el.attributes[String(name)] = String(value) },
      getAttribute(name) { return Object.hasOwn(el.attributes, name) ? el.attributes[name] : null },
      removeAttribute(name) { delete el.attributes[name] },
      appendChild(child) {
        const c = session.unwrap(child)
        if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1)
        c.parent = el
        el.children.push(c)
        return child
      },
      remove() {
        if (!el.parent) return
        el.parent.children.splice(el.parent.children.indexOf(el), 1)
        el.parent = null
      },
      getBoundingClientRect() {
        if (el !== session.root) throw new Error(`fake DOM: getBoundingClientRect only supported on the root <svg>, got <${tag}>`)
        return { left: 0, top: 0, right: session.size, bottom: session.size, width: session.size, height: session.size, x: 0, y: 0 }
      },
    })
    session.targets.set(this.proxy, this)
  }

  serialize() {
    // CSSOM semantics: assigning "" removes the declaration, so drop it.
    const style = {}
    for (const [k, v] of Object.entries(this.style)) if (v !== '') style[k] = v
    return {
      tag: this.tag,
      attributes: { ...this.attributes },
      style,
      children: this.children.map((c) => c.serialize()),
    }
  }
}

class Session {
  constructor({ seed, reduced, size }) {
    this.seed = seed
    this.reduced = reduced
    this.size = size
    this.frame = 0
    this.clock = 0
    this.ageMs = 0
    this.rafId = 0
    this.rafQueue = []
    this.targets = new WeakMap()
    this.root = null
    this.refs = []
    this.effects = []
    this.idCounter = 0
  }

  unwrap(proxy) {
    const el = this.targets.get(proxy)
    if (!el) throw new Error('fake DOM: appendChild received a non-element')
    return el
  }

  globals() {
    const session = this
    return {
      performance: strictProxy('performance', { now: () => session.clock }),
      requestAnimationFrame(cb) {
        if (typeof cb !== 'function') throw new Error('requestAnimationFrame: callback required')
        const id = ++session.rafId
        session.rafQueue.push({ id, cb })
        return id
      },
      cancelAnimationFrame(id) { session.rafQueue = session.rafQueue.filter((e) => e.id !== id) },
      document: strictProxy('document', {
        createElementNS(ns, tag) {
          if (ns !== SVG_NS) throw new Error(`fake DOM: unsupported namespace ${ns}`)
          return new FakeElement(tag, session).proxy
        },
      }),
      window: strictProxy('window', {
        matchMedia(query) {
          if (query !== '(prefers-reduced-motion: reduce)') throw new Error(`fake window.matchMedia: unsupported query ${query}`)
          return { matches: session.reduced }
        },
      }),
    }
  }

  react() {
    const session = this
    return strictProxy('fake React', {
      forwardRef(render) { return { render } },
      useId() { return `:r${session.idCounter++}:` },
      useRef(initial) { const ref = { current: initial }; session.refs.push(ref); return ref },
      useImperativeHandle(ref, create) { if (ref) ref.current = create() },
      useEffect(effect) { session.effects.push(effect) },
    })
  }

  materialize(node) {
    if (node == null || typeof node === 'boolean') return []
    if (Array.isArray(node)) return node.flatMap((n) => this.materialize(n))
    if (typeof node !== 'object' || !node.$vnode) throw new Error(`fake JSX: unsupported child ${typeof node}`)
    if (typeof node.type !== 'string') throw new Error('fake JSX: only intrinsic SVG elements are supported')
    const el = new FakeElement(node.type, this)
    const { children, ref, style, ...rest } = node.props
    for (const [k, v] of Object.entries(rest)) {
      if (v == null) continue
      el.attributes[attrName(k)] = String(v)
    }
    if (style) {
      for (const [k, v] of Object.entries(style)) {
        if (v == null) continue
        el.style[cssName(k)] = typeof v === 'number' && v !== 0 && !STYLE_UNITLESS.has(k) ? `${v}px` : String(v)
      }
    }
    for (const child of this.materialize(children)) { child.parent = el; el.children.push(child) }
    if (typeof ref === 'function') ref(el.proxy)
    else if (ref && typeof ref === 'object') ref.current = el.proxy
    return [el]
  }

  step() {
    this.frame += 1
    this.clock = this.frame * 1000 / 60
    const queue = this.rafQueue
    this.rafQueue = []
    for (const { cb } of queue) cb(this.clock)
  }
}

export const GROK_STATES = (() => {
  const ctx = vm.createContext({})
  const exports = {}
  scripts().module.runInContext(ctx)({ forwardRef: (f) => f }, () => null, () => null, exports)
  return exports.STATE_NAMES
})()

/**
 * createCapture(name, options)
 *   name: a GROK_STATES entry (state capture) or GROK_ACTIONS entry
 *         (state "idle" with the action fired at ACTION_TRIGGER_SECONDS).
 *   options.seed    integer seed for Math.random (default DEFAULT_SEED)
 *   options.reduced prefers-reduced-motion (default false)
 *   options.size    rendered pixel size reported to the renderer (default 340)
 *   options.state   state used for an action capture (default "idle")
 * Returns { advance(seconds), snapshot(), trigger(action), age(), frame(), name, kind }.
 */
export function createCapture(name, { seed = DEFAULT_SEED, reduced = false, size = DEFAULT_SIZE, state } = {}) {
  const isState = GROK_STATES.includes(name)
  const isAction = Object.hasOwn(ACTIONS, name)
  if (!isState && !isAction) throw new Error(`unknown Grok state or action "${name}"`)
  if (state !== undefined && !GROK_STATES.includes(state)) throw new Error(`unknown Grok state "${state}"`)
  if (!Number.isInteger(seed)) throw new Error('seed must be an integer')
  const renderState = isState ? name : (state ?? 'idle')

  const session = new Session({ seed, reduced, size })
  const ctx = vm.createContext(session.globals())
  const { module, random } = scripts()
  random.runInContext(ctx)(seed)
  const exports = {}
  const jsx = (type, props, key) => ({ $vnode: true, type, props: props ?? {}, key })
  module.runInContext(ctx)(session.react(), jsx, jsx, exports)

  const handleRef = { current: null }
  const vnode = exports.OfficialGrokBotRenderer.render({ state: renderState, shape: 'blob', size }, handleRef)
  const roots = session.materialize(vnode)
  if (roots.length !== 1 || roots[0].tag !== 'svg') throw new Error('renderer did not produce a single <svg> root')
  session.root = roots[0]
  const cleanups = session.effects.map((effect) => effect())
  const internal = session.refs.find((r) => r.current && !session.targets.has(r.current) && typeof r.current.spinKind === 'function')
  if (!internal) throw new Error('instrumented B.current handle not found')
  const handle = internal.current

  let pending = isAction ? ACTIONS[name] : null
  const fire = (action) => {
    action(handle)
  }
  const firePending = () => {
    if (!pending) return
    const action = pending
    pending = null
    session.clock = Math.max(session.clock, ACTION_TRIGGER_SECONDS * 1000)
    fire(action)
  }

  return {
    name,
    kind: isState ? 'state' : 'action',
    state: renderState,
    advance(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('advance(seconds) needs a finite non-negative age')
      const targetMs = seconds * 1000
      if (targetMs < session.ageMs - 1e-9) throw new Error(`advance(${seconds}) is before the current age ${session.ageMs / 1000}`)
      for (;;) {
        const next = (session.frame + 1) * 1000 / 60
        if (next > targetMs + 1e-9) break
        if (pending && next >= ACTION_TRIGGER_SECONDS * 1000) firePending()
        session.step()
      }
      if (pending && targetMs >= ACTION_TRIGGER_SECONDS * 1000) firePending()
      session.ageMs = targetMs
    },
    snapshot() { return session.root.serialize() },
    trigger(action) {
      if (!Object.hasOwn(ACTIONS, action)) throw new Error(`unknown Grok action "${action}"`)
      fire(ACTIONS[action])
    },
    age() { return session.ageMs / 1000 },
    frame() { return session.frame },
    dispose() { for (const c of cleanups) if (typeof c === 'function') c() },
  }
}
