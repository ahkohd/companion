import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'Attention.tsx',
  readFileSync('web/components/Attention.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
// Strip imports before binding so references resolve to the fixture's globals.
const body = source.statements
  .filter((statement) => !ts.isImportDeclaration(statement))
  .map((statement) => statement.getFullText(source))
  .join('\n')
const code = ts.transpileModule(body, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText
const tapCode = ts.transpileModule(readFileSync('web/lib/attention-tap.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const tapContext = { exports: {}, performance, setTimeout, clearTimeout }
vm.runInNewContext(tapCode, tapContext)

const nodes = (n) =>
  Array.isArray(n)
    ? n.flatMap(nodes)
    : n && typeof n === 'object'
      ? [n, ...nodes(n.props?.children)]
      : []

function fixture(exportName = 'default', given = {}) {
  const state = []
  const requests = []
  let hook = 0
  let tree
  let props

  const jsx = (type, props) => ({ type, props })

  const context = {
    exports: {},
    AttentionTapGate: tapContext.exports.AttentionTapGate,
    performance,

    require: () => ({ jsx, jsxs: jsx }),

    console,

    useState: (value) => {
      const index = hook++

      if (!(index in state)) {
        state[index] = value
      }

      return [state[index], (next) => (state[index] = next)]
    },

    useRef: (value) => {
      const index = hook++
      state[index] ??= { current: value }

      return state[index]
    },

    useId: () => `attention`,

    useEffect: () => {},

    animations: [{ id: 'done', label: 'Ready' }],

    animationName: (value) => value,

    toast: { error: (value) => requests.push({ error: value }) },

    fetch: async (url, options) => {
      requests.push({ url, payload: JSON.parse(options.body) })

      return { ok: true, json: async () => ({}) }
    },
  }

  for (const key of [
    'ArrowLeft',
    'Bell',
    'Check',
    'CircleAlert',
    'Clock',
    'ListOrdered',
    'Send',
    'Trash2',
    'Button',
    'Badge',
    'Input',
    'Switch',
  ]) {
    context[key] = key
  }

  vm.runInNewContext(code, context)
  const snapshot = {
    settings: {
      design: { face: { titleSize: 22, titleWidth: 300, nameSize: 16, nameWidth: 300 } },
    },
    attention: { enabled: true, active: null, queue: [], history: [] },
  }
  props = {
    snapshot,
    pending: false,

    action: async (path, payload) => {
      requests.push({ path, payload })

      return true
    },

    ...given,
  }

  const render = (patch) => {
    props = { ...props, ...patch }
    hook = 0
    tree = context.exports[exportName](props)
  }

  render()

  const find = (predicate) => nodes(tree).find(predicate)

  return {
    requests,
    render,
    find,

    get tree() {
      return tree
    },

    change(id, value) {
      find((n) => n.props.id === id).props.onChange({ target: { value } })
      render()
    },

    clickKind(kind) {
      find(
        (n) =>
          n.type === 'button' &&
          n.props['aria-pressed'] !== undefined &&
          JSON.stringify(n.props.children).includes(kind),
      ).props.onClick()
      render()
    },

    submit: () => find((n) => n.type === 'form').props.onSubmit({ preventDefault() {} }),
  }
}

test('attention composer sends bounded notifications and decisions with correct API ownership', async () => {
  const f = fixture()

  await f.submit()
  const notice = f.requests[0]

  assert.equal(notice.path, 'attention/show')
  assert.equal(notice.payload.owner, 'studio')
  assert.equal(notice.payload.durationMs, 10000)
  assert.equal(notice.payload.actions, undefined)

  f.clickKind('Decision')
  f.change('attention-action-count', '2')
  f.change('attention-primary', 'Approve')
  f.change('attention-secondary', 'Cancel')
  await f.submit()
  const decision = f.requests[1].payload

  assert.equal(decision.kind, 'decision')
  assert.equal(decision.durationMs, undefined)
  assert.deepEqual(JSON.parse(JSON.stringify(decision.actions)), [
    { id: 'primary', label: 'Approve', kind: 'respond' },
    { id: 'secondary', label: 'Cancel', kind: 'dismiss' },
  ])

  f.change('attention-title', '😀'.repeat(25))

  assert.equal(Array.from(f.find((n) => n.props.id === 'attention-title').props.value).length, 24)

  f.render({ pending: true })
  await f.submit()

  assert.equal(f.requests.length, 2)
})

test('attention single choices wait 300ms and retain the displayed request revision', async () => {
  const request = {
    id: 'request-a',
    owner: 'tool',
    revision: 4,
    kind: 'decision',
    title: 'Continue?',
    description: 'Review this choice',
    body: 'Details',
    actions: [{ id: 'approve', label: 'Approve', kind: 'respond' }],
    detail: true,
  }
  const f = fixture('AttentionOverlay', { request, detail: true })

  f.tree.props.onClick({
    detail: 0,

    stopPropagation() {},

    target: { closest: () => ({ getAttribute: () => 'approve' }) },
  })

  assert.equal(f.requests.length, 0)

  await new Promise((resolve) => setTimeout(resolve, 320))

  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url, '/api/attention/act')
  assert.deepEqual(JSON.parse(JSON.stringify(f.requests[0].payload)), {
    id: 'request-a',
    revision: 4,
    action: 'approve',
  })
})

test('double taps cancel approval even when the second finger crosses the 300ms deadline', () => {
  let now = 0
  let next = 0
  const timers = new Map()
  const calls = []
  const context = {
    exports: {},
    performance: { now: () => now },

    setTimeout: (fn, ms) => {
      timers.set(++next, { fn, at: now + ms })

      return next
    },

    clearTimeout: (id) => timers.delete(id),
  }

  vm.runInNewContext(tapCode, context)
  const Gate = context.exports.AttentionTapGate

  const advance = (ms) => {
    now += ms

    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id)
        t.fn()
      }
    }
  }

  const gate = new Gate(() => calls.push('dismiss'))
  gate.tap({ x: 200, y: 320 }, () => calls.push('approve'))
  advance(290)
  gate.press({ x: 203, y: 325 })
  advance(60)

  assert.deepEqual(calls, [])

  gate.tap({ x: 203, y: 325 }, () => calls.push('approve'))

  assert.deepEqual(calls, ['dismiss'])

  advance(1000)

  assert.deepEqual(calls, ['dismiss'])

  gate.tap({ x: 200, y: 320 }, () => calls.push('approve'))
  advance(290)
  gate.press({ x: 200, y: 320 })
  gate.cancel()
  advance(500)

  assert.deepEqual(calls, ['dismiss'])

  gate.tap({ x: 200, y: 320 }, () => calls.push('approve'))
  advance(300)

  assert.deepEqual(calls, ['dismiss', 'approve'])

  gate.tap({ x: 200, y: 320 }, () => calls.push('old revision'))
  gate.cancel()
  advance(500)

  assert.deepEqual(calls, ['dismiss', 'approve'])

  gate.tap({ x: 0, y: 0 }, () => calls.push('drift approval'))
  advance(100)
  gate.press({ x: 39, y: 0 })
  gate.tap({ x: 41, y: 0 }, () => calls.push('drift approval'))
  advance(60000)

  assert.deepEqual(calls, ['dismiss', 'approve'])

  gate.tap({ x: 0, y: 0 }, () => calls.push('fresh'))
  advance(300)

  assert.deepEqual(calls, ['dismiss', 'approve', 'fresh'])
})

test('leaving during a second press cancels the held action without dismissing later', async () => {
  const request = {
    id: 'request-a',
    owner: 'tool',
    revision: 4,
    kind: 'decision',
    title: 'Continue?',
    description: '',
    body: 'Details',
    actions: [{ id: 'approve', label: 'Approve', kind: 'respond' }],
    detail: true,
  }
  const f = fixture('AttentionOverlay', { request, detail: true })
  const target = { closest: () => ({ getAttribute: () => 'approve' }) }
  const event = {
    clientX: 200,
    clientY: 320,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 466, height: 466 }) },
    target,
    isPrimary: true,
    button: 0,
    pointerId: 1,
    detail: 1,

    stopPropagation() {},
  }

  f.tree.props.onPointerDown(event)
  f.tree.props.onPointerUp(event)
  f.tree.props.onClick(event)
  f.tree.props.onPointerDown(event)
  f.tree.props.onPointerLeave()
  await new Promise((resolve) => setTimeout(resolve, 320))

  assert.equal(f.requests.length, 0)

  f.tree.props.onPointerDown(event)
  f.tree.props.onPointerUp(event)
  f.tree.props.onPointerLeave()
  f.tree.props.onClick(event)
  await new Promise((resolve) => setTimeout(resolve, 320))

  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].url, '/api/attention/act')
})
