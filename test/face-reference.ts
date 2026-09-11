export * from '../web/face-model'
import { BotEngine } from '../web/vendor/bloub/engine'
import { EXPRESSION_BY_ID } from '../web/vendor/bloub/expressions'
import type { FaceState } from '../web/face-model'

export function reference(state: FaceState) {
  const id = state === 'done' ? 'wink' : state === 'blocked' ? 'wide' : 'idle'
  let expression =
    EXPRESSION_BY_ID.get(
      (
        {
          working: 'curieux',
          unknown: 'confus',
          sleep: 'somnolent',
          disconnected: 'somnolent',
        } as Record<string, string>
      )[state] ?? '',
    ) ?? null

  if (expression && ['sleep', 'disconnected'].includes(state))
    expression = {
      ...expression,
      eyes: expression.eyes.map((e) => ({
        ...e,
        w: 0.4,
        h: 0.07,
        open: 1,
      })) as typeof expression.eyes,
    }

  return new BotEngine(100, id, null, expression)
}
