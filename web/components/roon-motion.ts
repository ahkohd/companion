import { useLayoutEffect, useRef, useState } from 'react'

const ease = (value: number) => 1 - (1 - Math.min(1, Math.max(0, value))) ** 3

const upright = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180

type Motion = { progress: number; chrome: number; angle: number }

type Timeline = {
  motion: Motion
  target: number
  previous: number
  spinning: boolean
  geometry: { at: number; progress: number; chrome: number; target: number } | null
  orientation: { at: number; angle: number } | null
}

function sample(state: Timeline, now: number) {
  let { progress, chrome, angle } = state.motion

  if (state.geometry) {
    const from = state.geometry
    const elapsed = now - from.at
    progress = from.progress + (from.target - from.progress) * ease(elapsed / 280)
    chrome = from.chrome + (1 - from.target - from.chrome) * ease(elapsed / 180)

    if (elapsed >= 280) {
      state.geometry = null
    }
  }

  if (state.orientation) {
    const from = state.orientation
    const elapsed = now - from.at
    angle = from.angle * (1 - ease(elapsed / 280))

    if (elapsed >= 280) {
      state.orientation = null
    }
  } else if (state.spinning) {
    // Avoid a large visual jump when a background tab resumes rendering.
    angle = (angle + Math.min(100, Math.max(0, now - state.previous)) * 0.018 + 360) % 360
  }

  state.previous = now
  state.motion = { progress, chrome, angle }
}

// A rotated square must cover the whole rounded clip while it changes shape.
export function roonArtworkScale(size: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180
  const corner = Math.max(0, 1 - (Math.min(size / 2, Math.max(0, radius)) * 2) / size)

  return 1 + corner * Math.max(0, Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) - 1)
}

export function useRoonMotion(
  expanded: boolean,
  playing: boolean,
  animate: boolean,
  spin: boolean,
  reduced: boolean,
) {
  const timeline = useRef<Timeline>({
    motion: { progress: expanded ? 1 : 0, chrome: expanded ? 0 : 1, angle: 0 },
    target: expanded ? 1 : 0,
    previous: performance.now(),
    spinning: false,
    geometry: null,
    orientation: null,
  })

  const [motion, setMotion] = useState(timeline.current.motion)

  useLayoutEffect(() => {
    const state = timeline.current
    const now = performance.now()
    const target = expanded ? 1 : 0
    sample(state, now)

    if (reduced || !animate) {
      state.geometry = null
      state.motion = { ...state.motion, progress: target, chrome: 1 - target }
    } else if (target !== state.target) {
      state.geometry = {
        at: now,
        progress: state.motion.progress,
        chrome: state.motion.chrome,
        target,
      }
    }

    state.target = target
    const holdOrientation = expanded && spin && !reduced

    if (holdOrientation) {
      state.orientation = null
    } else if (reduced || !animate) {
      state.orientation = null
      state.motion = { ...state.motion, angle: 0 }
    } else if (!state.orientation && state.motion.angle !== 0) {
      state.orientation = { at: now, angle: upright(state.motion.angle) }
    }

    state.spinning = holdOrientation && playing
    setMotion(state.motion)
    let frame = 0

    const active = () => state.spinning || state.geometry !== null || state.orientation !== null

    const tick = (time: number) => {
      sample(state, time)
      setMotion(state.motion)

      if (active()) {
        frame = requestAnimationFrame(tick)
      }
    }

    if (active()) {
      frame = requestAnimationFrame(tick)
    }

    return () => cancelAnimationFrame(frame)
  }, [expanded, playing, animate, spin, reduced])

  return motion
}
