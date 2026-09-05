// Run: node scripts/grok-source/stats.mjs
// Prints snapshot size statistics for every state and action as markdown.
import { createCapture, GROK_STATES, GROK_ACTIONS } from './capture.mjs'

const AGES = [0.5, 1, 2, 4, 8]
const count = (n) => 1 + n.children.reduce((s, c) => s + count(c), 0)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

const rows = []
let totalMs = 0
for (const name of [...GROK_STATES, ...GROK_ACTIONS]) {
  const t0 = performance.now()
  const cap = createCapture(name, { seed: 1 })
  const bytes = [], nodes = []
  for (const age of AGES) {
    cap.advance(age)
    const snap = cap.snapshot()
    bytes.push(JSON.stringify(snap).length)
    nodes.push(count(snap))
  }
  totalMs += performance.now() - t0
  rows.push({ name, kind: GROK_STATES.includes(name) ? 'state' : 'action', bytes, nodes })
}

console.log(`| name | kind | JSON bytes min / median / max | nodes min / max |`)
console.log(`|---|---|---|---|`)
for (const r of rows) {
  console.log(`| ${r.name} | ${r.kind} | ${Math.min(...r.bytes)} / ${median(r.bytes)} / ${Math.max(...r.bytes)} | ${Math.min(...r.nodes)} / ${Math.max(...r.nodes)} |`)
}
const all = rows.flatMap((r) => r.bytes)
console.log()
console.log(`Samples: ${rows.length} captures x ${AGES.length} ages (${AGES.join(', ')} s), seed 1.`)
console.log(`Overall JSON bytes: min ${Math.min(...all)}, median ${median(all)}, max ${Math.max(...all)}.`)
console.log(`Total wall time for all captures including 8 s of frames each: ${(totalMs / 1000).toFixed(2)} s.`)
