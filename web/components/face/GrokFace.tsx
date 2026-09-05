import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import catalog from '../../../shared/grok-catalog.json'
import type { Gaze } from '../../face-model'
import { GrokPlayer, grokRaster } from '../../grok-player'

export type GrokFaceProps = {
  animation: string
  age: number
  reduced: boolean
  gaze: Gaze
  faceScale?: number
  backgroundColor?: number
  foregroundColor?: number
}

type Surface = {
  context: CanvasRenderingContext2D
  pixels: Uint16Array
  image: ImageData
  previousX: number
  previousY: number
  previousScale: number
  previousBackground: number
  previousForeground: number
  palette: Uint16Array
}

const SIZE = 466

export default function GrokFace(props: GrokFaceProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const surface = useRef<Surface | null>(null)
  const player = useRef<GrokPlayer | null>(null)
  const current = useRef(props)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const clip = catalog.find(item => item.id === props.animation)

  const draw = useCallback(() => {
    const target = surface.current
    const active = player.current
    if (!target || !active) return
    const { age, reduced, gaze, faceScale = 100, backgroundColor=0, foregroundColor=0xffffff } = current.current
    const x = gaze.x * gaze.mix
    const y = gaze.y * gaze.mix
    try {
      const changed = active.sample(age, reduced)
      if (!changed && x === target.previousX && y === target.previousY && faceScale === target.previousScale && backgroundColor===target.previousBackground && foregroundColor===target.previousForeground) return
      grokRaster(active.pixels, target.pixels, SIZE, SIZE, x, y, faceScale)
      if(backgroundColor!==target.previousBackground || foregroundColor!==target.previousForeground){
        for(let green=0;green<64;green++){
          const coverage=(green<<2)|(green>>4)
          const channel=(shift:number)=>Math.floor(((((backgroundColor>>shift)&255)*(255-coverage)+((foregroundColor>>shift)&255)*coverage+127)/255))
          target.palette[green]=((channel(16)>>3)<<11)|((channel(8)>>2)<<5)|(channel(0)>>3)
        }
      }
      const rgba = target.image.data
      for (let i = 0; i < target.pixels.length; i++) {
        let pixel = target.pixels[i]!
        const red=pixel>>11,green=(pixel>>5)&63,blue=pixel&31
        if(red===blue && (green>>1)===red)pixel=target.palette[green]!
        const r = pixel >> 11
        const g = (pixel >> 5) & 63
        const b = pixel & 31
        rgba[i * 4] = (r << 3) | (r >> 2)
        rgba[i * 4 + 1] = (g << 2) | (g >> 4)
        rgba[i * 4 + 2] = (b << 3) | (b >> 2)
      }
      target.context.putImageData(target.image, 0, 0)
      target.previousX = x
      target.previousY = y
      target.previousScale = faceScale
      target.previousBackground=backgroundColor
      target.previousForeground=foregroundColor
      if (canvas.current) canvas.current.dataset.frame = String(active.index)
    } catch (cause) {
      target.context.clearRect(0, 0, SIZE, SIZE)
      player.current = null
      setError(cause instanceof Error ? cause.message : 'Animation unavailable')
    }
  }, [])

  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) {
      setError('Animation preview unavailable')
      return
    }
    const image = context.createImageData(SIZE, SIZE)
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255
    surface.current = {
      context, image, pixels: new Uint16Array(SIZE * SIZE), previousX: NaN, previousY: NaN, previousScale: NaN, previousBackground: NaN, previousForeground: NaN, palette:new Uint16Array(64),
    }
    return () => { surface.current = null }
  }, [])

  useLayoutEffect(() => {
    player.current = null
    surface.current?.context.clearRect(0, 0, SIZE, SIZE)
    if (canvas.current) delete canvas.current.dataset.frame
  }, [props.animation])

  useLayoutEffect(() => {
    current.current = props
    draw()
  }, [props.age, props.reduced, props.gaze.x, props.gaze.y, props.gaze.mix, props.faceScale, props.backgroundColor, props.foregroundColor, props.animation, draw])

  useEffect(() => {
    const controller = new AbortController()
    player.current = null
    setLoading(true)
    setError('')
    surface.current?.context.clearRect(0, 0, SIZE, SIZE)
    if (canvas.current) delete canvas.current.dataset.frame

    const load = async () => {
      if (!clip) {
        setError('Unknown animation')
        setLoading(false)
        return
      }
      try {
        if (!surface.current) throw Error('Animation preview unavailable')
        const response = await fetch(`/grok/${clip.source}.bin`, { signal: controller.signal })
        if (!response.ok) throw Error('Animation unavailable')
        const buffer = await response.arrayBuffer()
        if (controller.signal.aborted) return
        player.current = new GrokPlayer(buffer)
        if (surface.current) surface.current.previousX = surface.current.previousY = NaN
        setLoading(false)
        draw()
      } catch (cause) {
        if (controller.signal.aborted) return
        player.current = null
        setError(cause instanceof Error ? cause.message : 'Animation unavailable')
        setLoading(false)
      }
    }
    void load()

    return () => {
      controller.abort()
      player.current = null
    }
  }, [clip, draw])

  return <>
    <canvas ref={canvas} className="grok-canvas" width={SIZE} height={SIZE} role="img"
      aria-label={`${clip?.label ?? props.animation.replace('grok:', '')} animation`}
      aria-busy={loading} />
    {(loading || error) && <span className="grok-error" role="status">{error || 'Loading animation'}</span>}
  </>
}
