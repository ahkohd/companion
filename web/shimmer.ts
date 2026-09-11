import config from '../shared/shimmer.json'

const rgb = (strength: number) =>
  config.base.map((value, i) => Math.round(value + (config.highlight[i]! - value) * strength))

const cssColor = (strength: number) => `rgb(${rgb(strength).join(',')})`

const stops = Array.from({ length: 17 }, (_, i) => {
  const offset = (i - 8) / 8

  return { offset: offset * config.band, color: cssColor((1 + Math.cos(Math.PI * offset)) / 2) }
})

const subtitleRgb = (strength: number) =>
  config.nameBase.map((value, i) =>
    Math.round(value + (config.nameHighlight[i]! - value) * strength),
  )

const subtitleCssColor = (strength: number) => `rgb(${subtitleRgb(strength).join(',')})`

const subtitleStops = Array.from({ length: 17 }, (_, i) => {
  const offset = (i - 8) / 8

  return {
    offset: offset * config.band,
    color: subtitleCssColor((1 + Math.cos(Math.PI * offset)) / 2),
  }
})

export function shimmerCenter(time: number): number | null {
  if (!Number.isFinite(time) || time < 0) {
    return null
  }

  const phase = time % config.period

  return phase < config.sweep ? -config.band + ((1 + 2 * config.band) * phase) / config.sweep : null
}

export function shimmerColor(time: number, u: number, reduced = false) {
  const centre = reduced ? null : shimmerCenter(time)
  const distance = centre === null ? 1 : Math.abs(u - centre) / config.band

  const strength =
    Number.isFinite(distance) && distance < 1 ? (1 + Math.cos(Math.PI * distance)) / 2 : 0

  return rgb(strength)
}

export function shimmerGradient(time: number, reduced = false) {
  const centre = reduced ? null : shimmerCenter(time)

  if (centre === null) {
    return `linear-gradient(90deg,${cssColor(0)},${cssColor(0)})`
  }

  return `linear-gradient(90deg,${stops.map((s) => `${s.color} ${((centre + s.offset) * 100).toFixed(3)}%`).join(',')})`
}

export function subtitleShimmerColor(time: number, u: number, reduced = false) {
  const centre = reduced ? null : shimmerCenter(time)
  const distance = centre === null ? 1 : Math.abs(u - centre) / config.band

  return subtitleRgb(
    Number.isFinite(distance) && distance < 1 ? (1 + Math.cos(Math.PI * distance)) / 2 : 0,
  )
}

export function subtitleShimmerGradient(time: number, reduced = false) {
  const centre = reduced ? null : shimmerCenter(time)

  if (centre === null) {
    return `linear-gradient(90deg,${subtitleCssColor(0)},${subtitleCssColor(0)})`
  }

  return `linear-gradient(90deg,${subtitleStops.map((s) => `${s.color} ${((centre + s.offset) * 100).toFixed(3)}%`).join(',')})`
}

export function customShimmerGradient(
  time: number,
  reduced: boolean,
  color: number,
  subtitle = false,
) {
  if (color === (subtitle ? 0x7e768c : 0xf2edfa)) {
    return subtitle ? subtitleShimmerGradient(time, reduced) : shimmerGradient(time, reduced)
  }

  const peak = [(color >> 16) & 255, (color >> 8) & 255, color & 255]
  const base = peak.map((c) => Math.round(c * (subtitle ? 0.7 : 0.64)))

  const css = (strength: number) =>
    `rgb(${base.map((v, i) => Math.round(v + (peak[i]! - v) * strength)).join(',')})`

  const center = reduced ? null : shimmerCenter(time)

  if (center === null) {
    return `linear-gradient(90deg,${css(0)},${css(0)})`
  }

  return `linear-gradient(90deg,${Array.from({ length: 17 }, (_, i) => {
    const o = (i - 8) / 8

    return `${css((1 + Math.cos(Math.PI * o)) / 2)} ${((center + o * config.band) * 100).toFixed(3)}%`
  }).join(',')})`
}

export function paletteShimmerGradient(
  time: number,
  reduced: boolean,
  baseColor: number,
  peakColor: number,
) {
  const channels = (color: number) => [(color >> 16) & 255, (color >> 8) & 255, color & 255]

  const base = channels(baseColor)
  const peak = channels(peakColor)

  const css = (strength: number) =>
    `rgb(${base.map((value, i) => Math.round(value + (peak[i]! - value) * strength)).join(',')})`

  const center = reduced ? null : shimmerCenter(time)

  if (center === null) {
    return `linear-gradient(90deg,${css(0)},${css(0)})`
  }

  return `linear-gradient(90deg,${Array.from({ length: 17 }, (_, i) => {
    const offset = (i - 8) / 8

    return `${css((1 + Math.cos(Math.PI * offset)) / 2)} ${((center + offset * config.band) * 100).toFixed(3)}%`
  }).join(',')})`
}
