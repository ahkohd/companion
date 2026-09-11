import { memo, useEffect, useId, useLayoutEffect, useState } from 'react'
import { customShimmerGradient, paletteShimmerGradient } from '../../shimmer'
import { type FaceProps, FaceTimeline, faceMode } from './face-timeline'

export type { FaceProps } from './face-timeline'

export function useReducedMotion(preference = false) {
  const [systemReduced, setSystemReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')

    const onChange = (event: MediaQueryListEvent) => setSystemReduced(event.matches)

    setSystemReduced(query.matches)
    query.addEventListener('change', onChange)

    return () => query.removeEventListener('change', onChange)
  }, [])

  return preference || systemReduced
}

function Face(props: FaceProps) {
  const reduced = useReducedMotion(props.reduced)

  const [timeline] = useState(() => new FaceTimeline(props, reduced, performance.now(), Date.now()))
  const [frame, setFrame] = useState(() => timeline.sample())

  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only timeline inputs trigger an update; labels and palette changes must not restart motion.
  useLayoutEffect(() => {
    setFrame(timeline.update(props, reduced, performance.now(), Date.now()))
  }, [
    timeline,
    props.state,
    props.changedAt,
    props.animationMs,
    props.ageMs,
    props.preview,
    props.look?.x,
    props.look?.y,
    reduced,
  ])

  // biome-ignore lint/correctness/useExhaustiveDependencies(reduced): Restart the frame loop when reduced motion changes through the timeline.
  useEffect(() => {
    let raf = 0
    let disposed = false

    const tick = (time: number) => {
      raf = 0

      if (disposed || document.hidden || timeline.reduced) {
        return
      }

      setFrame(timeline.tick(time, Date.now()))
      raf = requestAnimationFrame(tick)
    }

    const resume = () => {
      cancelAnimationFrame(raf)
      raf = 0

      if (!document.hidden && !timeline.reduced) {
        raf = requestAnimationFrame(tick)
      }
    }

    resume()
    document.addEventListener('visibilitychange', resume)

    const interval = window.setInterval(() => {
      if (faceMode(timeline.input, Date.now()) !== timeline.engine.state) {
        setFrame(timeline.tick(performance.now(), Date.now()))
      }
    }, 1000)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [timeline, reduced])

  let eyeColor = frame.color

  if (props.palette) {
    const palette = props.palette

    const color = ['idle', 'sleep', 'unknown'].includes(frame.mode)
      ? palette.foreground
      : frame.mode === 'disconnected'
        ? palette.muted
        : frame.mode === 'working' && palette.accent !== 0x65c18c
          ? palette.accent
          : frame.mode === 'done' && palette.success !== 0x65c18c
            ? palette.success
            : frame.mode === 'blocked' && palette.warning !== 0xd9be81
              ? palette.warning
              : undefined

    if (color !== undefined) {
      eyeColor = `#${color.toString(16).padStart(6, '0')}`
    }
  }

  return (
    <>
      <svg
        className="face-art"
        viewBox="-128 -128 256 256"
        role="img"
        aria-label={`${frame.mode} face`}
      >
        <defs>
          <clipPath id={`clip-${uid}`}>
            <circle r="100" />
          </clipPath>
        </defs>
        <g transform={`scale(${(props.faceScale ?? 100) / 100})`}>
          <g clipPath={`url(#clip-${uid})`} fill={eyeColor}>
            {frame.eyes.map((eye, index) => (
              <path
                // biome-ignore lint/suspicious/noArrayIndexKey: Fixed eye slots keep their identity while their paths morph.
                key={index}
                d={eye.d}
                transform={`matrix(${eye.matrix.join(',')})`}
                opacity={eye.alpha}
              />
            ))}
          </g>
        </g>
      </svg>
      {props.statusLabel && (
        <div className="screen-caption">
          <span
            className="shimmer-text"
            style={{
              backgroundImage: props.palette
                ? paletteShimmerGradient(
                    frame.time,
                    reduced,
                    props.palette.muted,
                    props.palette.foreground,
                  )
                : customShimmerGradient(frame.time, reduced, props.textColor ?? 0xf2edfa),
            }}
          >
            {props.statusLabel}
          </span>
        </div>
      )}

      {props.nameLabel && (
        <div className="screen-name">
          <span
            className="shimmer-text"
            style={{
              backgroundImage: props.palette
                ? paletteShimmerGradient(
                    frame.time,
                    reduced,
                    props.palette.muted,
                    props.palette.foreground,
                  )
                : customShimmerGradient(frame.time, reduced, props.mutedColor ?? 0x7e768c, true),
            }}
          >
            {props.nameLabel}
          </span>
        </div>
      )}
    </>
  )
}

export default memo(Face)
