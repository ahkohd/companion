import { EXPRESSION_BY_ID } from './vendor/bloub/expressions'
import { blinkScale, eyePoses, liveliness } from './vendor/bloub/face'
import { clamp, easings, lerp, r2 } from './vendor/bloub/math'
import { capsulePath } from './vendor/bloub/shape'
import { STATE_BY_ID } from './vendor/bloub/states'

export const FACE_STATES = [
  'working',
  'blocked',
  'done',
  'idle',
  'sleep',
  'unknown',
  'disconnected',
] as const

export type FaceState = (typeof FACE_STATES)[number]

export type FaceProfile = {
  gaze: { yaw: number; pitch: number; roll: number }
  split: number
  eyes: { w: number; h: number; open: number; tilt: number }[]
  color: number
}

const definitions = [
  ['idle', 'curieux', 0xd2c7ff],
  ['wide', null, 0xf3c78e],
  ['wink', null, 0xb4dbbe],
  ['idle', null, 0xd7d6e3],
  ['idle', 'somnolent', 0xd7d6e3],
  ['idle', 'confus', 0xb9bac3],
  ['idle', 'somnolent', 0x686b78],
] as const

export const FACE_PROFILES: Record<FaceState, FaceProfile> = Object.fromEntries(
  FACE_STATES.map((state, i) => {
    const [id, expression, color] = definitions[i]!
    const pose = STATE_BY_ID.get(id)!.pose(1)
    const face = expression ? EXPRESSION_BY_ID.get(expression)! : pose

    return [
      state,
      {
        gaze: { ...face.gaze },
        split: face.split,
        color,
        eyes: face.eyes.map((eye) => ({
          ...eye,
          tilt: eye.tilt ?? 0,
          ...(['sleep', 'disconnected'].includes(state) ? { w: 0.4, h: 0.07, open: 1 } : {}),
        })),
      },
    ]
  }),
) as Record<FaceState, FaceProfile>

export function blendProfile(a: FaceProfile, b: FaceProfile, t: number): FaceProfile {
  return {
    gaze: {
      yaw: lerp(a.gaze.yaw, b.gaze.yaw, t),
      pitch: lerp(a.gaze.pitch, b.gaze.pitch, t),
      roll: lerp(a.gaze.roll, b.gaze.roll, t),
    },
    split: lerp(a.split, b.split, t),
    color: b.color,
    eyes: a.eyes.map((eye, i) => {
      const next = b.eyes[i]!

      return {
        w: lerp(eye.w, next.w, t),
        h: lerp(eye.h, next.h, t),
        open: lerp(eye.open, next.open, t),
        tilt: lerp(eye.tilt, next.tilt, t),
      }
    }),
  }
}

export const LOOK_RESPONSE = 10
export const LOOK_SETTLE_SECONDS = 1.5

export type Gaze = { x: number; y: number; mix: number }

export function renderEyes(profile: FaceProfile, time: number, look: Gaze) {
  const life = liveliness(time, { wander: 1 - look.mix })

  const poses = eyePoses(
    {
      yaw: lerp(profile.gaze.yaw, look.x * 25, look.mix) + life.dYaw,
      pitch: lerp(profile.gaze.pitch, -look.y * 20, look.mix) + life.dPitch,
      roll: profile.gaze.roll + life.dRoll,
    },
    100,
    profile.split,
  )

  return poses.map((pose, i) => {
    const eye = profile.eyes[i]!
    const angle = (eye.tilt * Math.PI) / 180
    const cp = Math.cos(angle)
    const sp = Math.sin(angle)
    const k = blinkScale(Math.min(life.lid, eye.open))

    const matrix = [
      pose.a * cp + pose.c * sp,
      (pose.b * cp + pose.d * sp) * k,
      -pose.a * sp + pose.c * cp,
      (-pose.b * sp + pose.d * cp) * k,
      pose.x + life.driftX * 100,
      pose.y + life.driftY * 100,
    ].map(r2)

    return {
      w: eye.w * 100,
      h: eye.h * 100,
      matrix,
      alpha: clamp(pose.depth / 0.12),
      d: capsulePath(eye.w * 100, eye.h * 100),
    }
  })
}

export class FaceMotion {
  state: FaceState
  from: FaceProfile
  target: FaceProfile
  since: number
  lookFrom: Gaze = { x: 0, y: 0, mix: 0 }
  lookTarget: Gaze = { x: 0, y: 0, mix: 0 }
  lookVelocity: Gaze = { x: 0, y: 0, mix: 0 }
  lookSince = 0

  constructor(state: FaceState, time = 0) {
    this.state = state
    this.from = this.target = FACE_PROFILES[state]
    this.since = time - 0.45
  }

  rebaseClock(from: number, to: number) {
    this.since += to - from
    this.lookSince += to - from
  }

  profile(time: number) {
    return blendProfile(
      this.from,
      this.target,
      easings.easeOutQuint(clamp((time - this.since) / 0.45)),
    )
  }

  setState(state: FaceState, time: number, immediate = false) {
    if (state === this.state) {
      return
    }

    this.from = this.profile(time)
    this.target = FACE_PROFILES[state]
    this.state = state
    this.since = time - (immediate ? 0.45 : 0)
  }

  private lookSample(time: number) {
    const dt = Math.max(0, time - this.lookSince)
    const value = { ...this.lookTarget }
    const velocity = { x: 0, y: 0, mix: 0 }

    if (dt < LOOK_SETTLE_SECONDS) {
      const decay = Math.exp(-LOOK_RESPONSE * dt)

      for (const key of ['x', 'y', 'mix'] as const) {
        const offset = this.lookFrom[key] - this.lookTarget[key]
        const b = this.lookVelocity[key] + LOOK_RESPONSE * offset
        value[key] += (offset + b * dt) * decay
        velocity[key] = (this.lookVelocity[key] - LOOK_RESPONSE * b * dt) * decay
      }
    }

    return { value, velocity }
  }

  look(time: number): Gaze {
    return this.lookSample(time).value
  }

  setLook(look: { x: number; y: number } | null, time: number, immediate = false) {
    const next = look ? { ...look, mix: 1 } : { ...this.lookTarget, mix: 0 }

    if (immediate) {
      this.lookFrom = this.lookTarget = next
      this.lookVelocity = { x: 0, y: 0, mix: 0 }
      this.lookSince = time

      return
    }

    if (
      next.x === this.lookTarget.x &&
      next.y === this.lookTarget.y &&
      next.mix === this.lookTarget.mix
    ) {
      return
    }

    // Carry position and velocity into each new target to avoid restarting the glide.
    const current = this.lookSample(time)
    this.lookFrom = current.value
    this.lookVelocity = current.velocity
    this.lookTarget = next
    this.lookSince = time
  }

  sample(time: number, still = false) {
    return renderEyes(this.profile(time), still ? 0 : time, this.look(time))
  }
}
