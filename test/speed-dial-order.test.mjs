import test from 'node:test'
import assert from 'node:assert/strict'
import { reorderSpeedDialButtons } from '../web/lib/speed-dial-order.ts'

const buttons = Object.freeze(
  ['a', 'b', 'c', 'd'].map((id) =>
    Object.freeze({ id, actions: [{ type: 'app', value: id }], enabled: id !== 'c' }),
  ),
)

const ids = (values) => values.map((button) => button.id).join('')

test('dragging inserts before or after a target in either direction without changing buttons', () => {
  for (const [id, target, after, expected] of [
    ['a', 'd', true, 'bcda'],
    ['d', 'a', false, 'dabc'],
    ['a', 'c', false, 'bacd'],
    ['d', 'b', true, 'abdc'],
    ['b', 'c', true, 'acbd'],
    ['c', 'b', false, 'acbd'],
  ]) {
    const result = reorderSpeedDialButtons(buttons, id, target, after)

    assert.equal(ids(result), expected)

    for (const button of result)
      assert.equal(
        button,
        buttons.find((original) => original.id === button.id),
      )

    assert.equal(ids(buttons), 'abcd')
  }
})

test('missing, identical and unchanged drop targets are no-ops', () => {
  for (const [id, target, after] of [
    ['a', 'a', true],
    ['missing', 'a', false],
    ['a', 'missing', true],
    ['a', 'b', false],
    ['b', 'a', true],
  ])
    assert.equal(reorderSpeedDialButtons(buttons, id, target, after), buttons)
})
