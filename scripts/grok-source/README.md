# Grok source capture

Deterministic, offline sampling of the upstream Grok Bot renderer in
`web/vendor/grok-bot/upstream-renderer.tsx` (unmodified copy, BIGAGENT commit
c7a498f0275229bdbad67c93c29e070bb85bd91b). No browser, React or network.

```js
import { createCapture, GROK_STATES, GROK_ACTIONS } from './scripts/grok-source/capture.mjs'

const cap = createCapture('thinking', { seed: 1 })   // or an action id such as 'spin-wild'
cap.advance(0.5)                                     // runs upstream rAF frames at 60 Hz up to 0.5 s
const tree = cap.snapshot()                          // { tag, attributes, style, children }
```

- `GROK_STATES`: 39 names in upstream `g1e` order.
- `GROK_ACTIONS`: `spin`, `double-spin`, `spin-bounce`, `spin-dizzy`, `spin-wild`, `bounce`, `burst`, `spin-burst`.
  Action captures render `idle` (override with `state`) and fire the action at 0.14 s.
- Options: `seed` (integer, default `0x6b726f6b`), `reduced` (default false), `size` (default 340), `state`.
- `advance(seconds)` is absolute age and monotonic. `snapshot()` is JSON serialisable.
  `trigger(action)` fires an action at the current age. `age()`, `frame()`, `dispose()`.

Colours stay as `var(--fg)`, `var(--bg)` and `var(--gb-badge, #1d9bf0)` strings.
`DEFAULT_CSS_VARS` suggests cyan on black.

Source instrumentation happens at load time only, see `PATCHES` in `capture.mjs`.
Tests: `node --test scripts/grok-source/capture.test.mjs`. Stats: `node scripts/grok-source/stats.mjs`.

The in-memory handle exposes the original click variants as well: double spin
sets `Qt` for wide trails; spin and burst uses `Hn.burst(16, 0.95, 0.3)`. The
separate burst action uses the upstream imperative burst parameters.
