import test from 'node:test'
import assert from 'node:assert/strict'
import schema from '../shared/design-schema.json' with { type: 'json' }
import {
  speedDialLayout,
  speedDialPageSize,
  SPEED_DIAL_MAX_SLOTS,
} from '../shared/speed-dial-layout.mjs'

const defaults = Object.fromEntries(schema.speedDial.map((field) => [field.key, field.default]))
const config = { layout: 'grid', gridSize: 0, listRows: 3, showLabels: true, screenShape: 'round' }

const intersects = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function labelHitsButton(label, button) {
  const radius = button.width / 2,
    cx = button.x + radius,
    cy = button.y + radius
  const x = Math.max(label.x, Math.min(cx, label.x + label.width))
  const y = Math.max(label.y, Math.min(cy, label.y + label.height))

  return (x - cx) ** 2 + (y - cy) ** 2 < radius ** 2
}

test('automatic packing uses seven round slots and nine rectangular slots at default sizes', () => {
  assert.equal(speedDialPageSize(config, defaults), 7)
  assert.equal(speedDialPageSize({ ...config, screenShape: 'rectangular' }, defaults), 9)

  const round = speedDialLayout(config, defaults).slots

  assert.deepEqual(
    [...new Set(round.map((slot) => slot.y))]
      .sort((a, b) => a - b)
      .map((y) => round.filter((slot) => slot.y === y).length),
    [2, 3, 2],
  )
  assert.equal(speedDialPageSize({ ...config, gridSize: 4 }, defaults), 4)
  assert.equal(speedDialPageSize({ ...config, gridSize: 6 }, defaults), 6)
})

test('packed buttons and labels stay on screen and keep pagination and navigation clear', () => {
  let seed = 12345

  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0

    return seed / 2 ** 32
  }

  const designs = [
    defaults,
    { ...defaults, buttonSize: 110, gap: 19, offsetY: 4 },
    ...['min', 'max'].map((key) =>
      Object.fromEntries(schema.speedDial.map((field) => [field.key, field[key]])),
    ),
  ]

  for (let i = 0; i < 500; i++)
    designs.push(
      Object.fromEntries(
        schema.speedDial.map((field) => [
          field.key,
          Math.floor(field.min + random() * (field.max - field.min + 1)),
        ]),
      ),
    )

  for (const design of designs)
    for (const screenShape of ['round', 'rectangular'])
      for (const showLabels of [true, false]) {
        const slots = speedDialLayout({ ...config, screenShape, showLabels }, design).slots
        const context = JSON.stringify({ design, screenShape, showLabels })

        assert.ok(slots.length >= 1 && slots.length <= SPEED_DIAL_MAX_SLOTS, context)

        for (const [i, slot] of slots.entries()) {
          assert.ok(slot.width >= 48 && slot.icon.size >= 24, context)

          const dense = screenShape === 'round' && !showLabels

          assert.ok(
            slot.x >= 12 &&
              slot.x + slot.width <= 454 &&
              slot.y >= 12 &&
              slot.y + slot.height <= (dense ? 454 : 408),
            context,
          )

          if (dense) {
            for (const rect of [
              { x: 205, y: 416, width: 56, height: 22, gap: 16 },
              { x: 181, y: 444, width: 104, height: 8, gap: 2 },
            ])
              assert.ok(
                !labelHitsButton(rect, {
                  ...slot,
                  x: slot.x - rect.gap,
                  y: slot.y - rect.gap,
                  width: slot.width + 2 * rect.gap,
                }),
                context,
              )

            if (slot.width < slots[0].width) {
              const neighbours = slots
                .slice(0, i)
                .filter(
                  (other) =>
                    (slot.x + slot.width / 2 - other.x - other.width / 2) ** 2 +
                      (slot.y + slot.height / 2 - other.y - other.height / 2) ** 2 <=
                    ((slot.width + other.width) / 2 + design.gap + 1) ** 2,
                )

              assert.ok(neighbours.length >= 2, context)
            }
          }

          if (screenShape === 'round')
            assert.ok(
              (slot.x + slot.width / 2 - 233) ** 2 + (slot.y + slot.height / 2 - 233) ** 2 <=
                (221 - slot.width / 2) ** 2,
              context,
            )

          if (slot.label) {
            assert.ok(slot.label.y + slot.label.height <= 408, context)

            if (screenShape === 'round')
              for (const x of [slot.label.x, slot.label.x + slot.label.width])
                for (const y of [slot.label.y, slot.label.y + slot.label.height])
                  assert.ok((x - 233) ** 2 + (y - 233) ** 2 <= 221 ** 2, context)
          }

          for (const other of slots.slice(i + 1)) {
            const dx = slot.x + slot.width / 2 - other.x - other.width / 2,
              dy = slot.y + slot.height / 2 - other.y - other.height / 2

            assert.ok(
              dx * dx + dy * dy >= ((slot.width + other.width) / 2 + (dense ? design.gap : 0)) ** 2,
              context,
            )

            if (slot.label && other.label) {
              assert.ok(!intersects(slot.label, other.label), context)
              assert.ok(
                !labelHitsButton(slot.label, other) && !labelHitsButton(other.label, slot),
                context,
              )
            }
          }
        }
      }
})

test('hidden labels cap pages at thirteen with nine large circles and four smaller side circles', () => {
  const slots = speedDialLayout({ ...config, showLabels: false }, defaults).slots

  assert.equal(slots.length, 13)
  assert.equal(slots.filter((s) => s.width === 74).length, 9)

  const middle = slots[0],
    top = slots[7],
    bottom = slots[8]

  assert.equal(top.x, middle.x)
  assert.equal(bottom.x, middle.x)
  assert.equal(middle.y + middle.height / 2, 206)
  assert.ok(416 - Math.max(...slots.map((s) => s.y + s.height)) >= 16)
  assert.ok(top.y < slots[3].y && bottom.y > slots[4].y)

  const edges = slots.slice(9)

  assert.equal(edges.length, 4)
  assert.ok(edges.every((s) => s.width === 55))

  for (const [i, edge] of edges.entries()) {
    assert.ok(edge.width >= 48)

    const gaps = slots
      .slice(0, 9 + 2 * Math.floor(i / 2))
      .map(
        (s) =>
          Math.hypot(
            edge.x + edge.width / 2 - s.x - s.width / 2,
            edge.y + edge.height / 2 - s.y - s.height / 2,
          ) -
          (edge.width + s.width) / 2,
      )
      .sort((a, b) => a - b)

    assert.ok(gaps[0] >= defaults.gap && gaps[1] <= defaults.gap + 1, JSON.stringify(gaps))
  }

  for (const [i, a] of slots.entries())
    for (const b of slots.slice(i + 1))
      assert.ok(
        Math.hypot(
          a.x + a.width / 2 - b.x - b.width / 2,
          a.y + a.height / 2 - b.y - b.height / 2,
        ) >=
          (a.width + b.width) / 2 + defaults.gap - 1,
      )
})

test('single-page honeycombs centre every visible group without changing capacity or spacing', () => {
  const designs = [
    defaults,
    { ...defaults, buttonSize: 95, gap: 19, offsetY: 16 },
    ...['min', 'max'].map((key) =>
      Object.fromEntries(schema.speedDial.map((f) => [f.key, f[key]])),
    ),
  ]

  for (const design of designs) {
    const paged = speedDialLayout({ ...config, showLabels: false, pageCount: 2 }, design)

    for (let buttonCount = 1; buttonCount <= paged.slots.length; buttonCount++) {
      const single = speedDialLayout(
        { ...config, showLabels: false, pageCount: 1, buttonCount },
        design,
      )

      assert.equal(single.slots.length, paged.slots.length)

      const visible = single.slots.slice(0, buttonCount),
        first = single.slots[0],
        origin = paged.slots[0]
      const cx =
        (Math.min(...visible.map((s) => s.x)) + Math.max(...visible.map((s) => s.x + s.width))) / 2
      const cy =
        (Math.min(...visible.map((s) => s.y)) + Math.max(...visible.map((s) => s.y + s.height))) / 2

      assert.ok(Math.abs(cx - 233) <= 0.5 && Math.abs(cy - 233 - design.offsetY) <= 0.5)

      for (const [i, s] of visible.entries()) {
        const before = paged.slots[i],
          dx = first.x - origin.x,
          dy = first.y - origin.y

        assert.deepEqual(s, {
          ...before,
          x: before.x + dx,
          y: before.y + dy,
          icon: { ...before.icon, x: before.icon.x + dx, y: before.icon.y + dy },
          status: { ...before.status, x: before.status.x + dx, y: before.status.y + dy },
        })
        assert.ok(
          (s.x + s.width / 2 - 233) ** 2 + (s.y + s.height / 2 - 233) ** 2 <=
            (221 - s.width / 2) ** 2,
        )
        assert.ok(
          !labelHitsButton(
            { x: 181, y: 444, width: 104, height: 8 },
            { ...s, x: s.x - 2, y: s.y - 2, width: s.width + 4 },
          ),
        )
      }
    }
  }
})

test('odd pitches and shifted clusters keep every opposite pair together', () => {
  for (const buttonSize of [80, 95, 96, 97, 112])
    for (const gap of [4, 5, 15, 16, 21, 32])
      for (const offsetY of [-32, 0, 32]) {
        const slots = speedDialLayout(
          { ...config, showLabels: false },
          { ...defaults, buttonSize, gap, offsetY },
        ).slots
        const middle = slots[0],
          context = JSON.stringify({ buttonSize, gap, offsetY })

        assert.equal(slots.length % 2, 1, context)

        for (let count = 1; count <= slots.length; count += 2) {
          const visible = slots.slice(0, count)

          assert.equal(
            visible.reduce((sum, s) => sum + s.x + s.width / 2, 0) / count,
            middle.x + middle.width / 2,
            context,
          )
          assert.equal(
            visible.reduce((sum, s) => sum + s.y + s.height / 2, 0) / count,
            middle.y + middle.height / 2,
            context,
          )
        }
      }
})

test('automatic pages fill from the centre in opposite pairs with large buttons first', () => {
  for (const screenShape of ['round', 'rectangular'])
    for (const showLabels of [false, true]) {
      const slots = speedDialLayout({ ...config, screenShape, showLabels }, defaults).slots
      const middle = slots[0],
        cx = middle.x + middle.width / 2,
        cy = middle.y + middle.height / 2

      assert.equal(cx, 233)

      for (let count = 1; count <= slots.length; count += 2) {
        const visible = slots.slice(0, count)

        assert.equal(visible.reduce((sum, s) => sum + s.x + s.width / 2, 0) / count, cx)
        assert.equal(visible.reduce((sum, s) => sum + s.y + s.height / 2, 0) / count, cy)
      }

      if (screenShape === 'round' && !showLabels) {
        assert.ok(slots.slice(0, 9).every((s) => s.width === 74))
        assert.ok(slots.slice(9).every((s) => s.width < 74))
        assert.ok(slots.some((s) => s.x + 37 === cx && s.y + 37 === cy))
      }
    }
})
