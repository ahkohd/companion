import { FACE_PROFILES, FACE_STATES, FaceMotion, type FaceState } from '../../face-model'

export type FaceProps = {
  faceScale?: number
  backgroundColor?: number
  foregroundColor?: number
  palette?: import('../../lib/studio').DevicePalette
  textColor?: number
  mutedColor?: number
  statusLabel?: string
  nameLabel?: string
  state: string
  changedAt: number
  animationMs: number
  ageMs: number
  reduced?: boolean
  preview?: boolean
  look?: { x: number; y: number } | null
}

const seconds = (ms: number) => (Number.isFinite(ms) ? Math.max(0, ms) / 1000 : 0)

const color = (value: number) => `#${value.toString(16).padStart(6, '0')}`

export function faceMode(input: FaceProps, wallTime: number): FaceState {
  if (!input.preview && input.state === 'idle' && wallTime - input.changedAt >= 30_000) {
    return 'sleep'
  }

  return FACE_STATES.includes(input.state as FaceState) ? (input.state as FaceState) : 'unknown'
}

// Browser time advances between host snapshots. A host restart rebases existing
// transitions, so neither eyes nor pointer movement jump to an old clock.
export class FaceTimeline {
  readonly engine: FaceMotion
  input: FaceProps
  reduced: boolean
  elapsed: number
  private hostAnimationMs: number
  private hostReceivedAt: number

  constructor(input: FaceProps, reduced: boolean, receivedAt: number, wallTime: number) {
    this.input = input
    this.reduced = reduced
    this.elapsed = seconds(input.animationMs)
    this.hostAnimationMs = this.elapsed * 1000
    this.hostReceivedAt = receivedAt
    this.engine = new FaceMotion(faceMode(input, wallTime), this.elapsed)
    this.engine.setLook(input.look ?? null, this.elapsed, reduced)
  }

  update(input: FaceProps, reduced: boolean, receivedAt: number, wallTime: number) {
    if (Number.isFinite(input.animationMs) && input.animationMs !== this.hostAnimationMs) {
      this.hostReceivedAt = receivedAt

      if (input.animationMs < this.hostAnimationMs - 100) {
        this.engine.rebaseClock(this.elapsed, seconds(input.animationMs))
        this.elapsed = seconds(input.animationMs)
      } else {
        this.elapsed = Math.max(this.elapsed, seconds(input.animationMs))
      }

      this.hostAnimationMs = Math.max(0, input.animationMs)
    }

    this.input = input
    this.reduced = reduced
    this.advance(receivedAt)
    this.engine.setState(faceMode(input, wallTime), this.elapsed, reduced)
    this.engine.setLook(input.look ?? null, this.elapsed, reduced)

    if (reduced) {
      this.engine.since = this.elapsed - 0.45
    }

    return this.sample()
  }

  tick(time: number, wallTime: number) {
    this.advance(time)
    this.engine.setState(faceMode(this.input, wallTime), this.elapsed, this.reduced)

    return this.sample()
  }

  private advance(time: number) {
    if (!this.reduced) {
      this.elapsed = Math.max(
        this.elapsed,
        this.hostAnimationMs / 1000 + Math.max(0, time - this.hostReceivedAt) / 1000,
      )
    }
  }

  sample() {
    const age = Math.max(
      0,
      this.elapsed - (seconds(this.input.animationMs) - seconds(this.input.ageMs)),
    )

    return {
      mode: this.engine.state,
      time: this.elapsed,
      age,
      gaze: this.engine.look(this.elapsed),
      color: color(FACE_PROFILES[this.engine.state].color),
      eyes: this.engine.sample(this.elapsed, this.reduced),
    }
  }
}
