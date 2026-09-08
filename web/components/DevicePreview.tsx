import { previewDisplay } from '../lib/board-preview'
import { AttentionOverlay } from './Attention'
import { resolveDesign } from '../../shared/device-appearance.mjs'
import { devicePaletteDefaults } from '../lib/device-appearance'
import { defaultDesign, designFor, colorHex, sansLine, pixelLine, percentageTop, type DesignValues, type Designs } from '../lib/design'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ChartNoAxesCombined, Clock, Mail, Music2, Radio, RotateCcw, ScanFace } from 'lucide-react'
import Face, { useReducedMotion } from './face/Face'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import { animationName, moduleNames, type ModuleId, type OpenCardRequest, type StudioSnapshot } from '../lib/studio'
import { paletteShimmerGradient } from '../shimmer'
import './device-preview.css'
import {RoonIcon} from './RoonIcon'
import {roonArtworkScale,useRoonMotion} from './roon-motion'

export interface DevicePreviewProps {
  snapshot: StudioSnapshot | null
  localAnimation?: string | null
  localReplay?: number
  onModule: (id: ModuleId) => void
  onLive: () => void
  onUsagePage: (direction: number) => void
  onHeyPage: (direction: number) => void
  onOpenCard?: (request: OpenCardRequest) => void
  onRoonControl?: (action: string) => void
  onRoonView?: (expanded:boolean) => void
  pending?: boolean
  online?: boolean
}

type Dashboard = NonNullable<StudioSnapshot['display']['dashboard']>
type Metric = Dashboard['primary']
const moduleIds: ModuleId[] = ['face', 'usage', 'hey', 'clock', 'roon']
const shortNames = { face: 'Face', usage: 'Usage', hey: 'HEY', clock: 'Clock', roon: 'Roon' }
const moduleIcons = { face: ScanFace, usage: ChartNoAxesCombined, hey: Mail, clock: Clock, roon: Music2 }
const encoder = new TextEncoder()

function wireText(value: string, bytes = 48) {
  let result = ''
  for (const character of value.replace(/[\x00-\x1f\x7f]/g, '').trim()) {
    if (encoder.encode(result + character).length > bytes) break
    result += character
  }
  return result
}

function ModuleLabel({ x, y, width, children, small = false, large = false, largeSize = 44, mail = false, pixel = false, muted = false, align = 'left', lines = 1, truncate = false, size, color }: {
  x: number; y: number; width: number; children: ReactNode; small?: boolean; large?: boolean; mail?: boolean; pixel?: boolean; muted?: boolean
  align?: CSSProperties['textAlign']; lines?: number; truncate?: boolean; largeSize?: number; size?:number; color?:string
}) {
  const fontSize=size ?? (large ? largeSize : small ? 16 : mail ? 28 : 22)
  const height=pixel ? pixelLine(fontSize) : sansLine(fontSize)
  return <foreignObject x={x} y={y} width={width} height={height * lines}>
    <div className={`dp-module-label${pixel ? ' dp-module-pixel' : ''}${muted ? ' dp-module-muted' : ''}${lines > 1 ? ' dp-module-wrap' : ''}`}
      style={{ fontSize, color, lineHeight: `${height}px`, textAlign: align,
        ...(truncate ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical' as const } : {}) }}>
      {children}
    </div>
  </foreignObject>
}

type CardAction = { request?: OpenCardRequest; label: string; disabled: boolean; onOpen?: (request: OpenCardRequest) => void; onSwipe: (x:number,y:number) => void }

function CardHit({ x, y, width, height, radius, request, label, disabled, onOpen, onSwipe }: CardAction & { x:number;y:number;width:number;height:number;radius:number }) {
  const gesture=useRef<{id:number;x:number;y:number;at:number;travel:number;token:string}|null>(null)
  const unavailable=disabled||!request||!onOpen
  const open=()=>{if(!unavailable)onOpen!(request!)}
  return <foreignObject x={x} y={y} width={width} height={height}>
    <button className="dp-card-hit" style={{borderRadius:radius}} disabled={unavailable} aria-label={label}
      onPointerDown={event=>{event.stopPropagation();if(unavailable||!event.isPrimary||event.button!==0)return;gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now(),travel:0,token:request!.token};event.currentTarget.setPointerCapture(event.pointerId)}}
      onPointerMove={event=>{const start=gesture.current;if(start?.id===event.pointerId)start.travel=Math.max(start.travel,Math.abs(event.clientX-start.x),Math.abs(event.clientY-start.y))}}
      onPointerUp={event=>{event.stopPropagation();const start=gesture.current;gesture.current=null;if(!start||start.id!==event.pointerId)return;const elapsed=performance.now()-start.at;if(elapsed>1500)return;const x=event.clientX-start.x,y=event.clientY-start.y;onSwipe(x,y);if(elapsed<=500&&start.travel<12&&Math.abs(x)<12&&Math.abs(y)<12&&start.token===request?.token)open()}}
      onPointerCancel={()=>{gesture.current=null}} onLostPointerCapture={()=>{gesture.current=null}}
      onClick={event=>{event.stopPropagation();if(event.detail===0)open()}}/>
  </foreignObject>
}

function UsageCard({ metric, y, fallback, showBackground, d, action }: { metric: Metric; y: number; fallback: string; showBackground: boolean; d:DesignValues; action:CardAction }) {
  const patternId = useId()
  const available = metric?.remaining !== null && Number.isFinite(metric?.remaining)
  const remaining = available ? Math.max(0, Math.min(100, metric!.remaining!)) : 0
  const barColor = colorHex(remaining <= 10 ? d.lowColor : remaining <= 25 ? d.warnColor : d.fillColor)
  const inner=d.width-2*d.padding, x=d.x+d.padding
  const filledWidth=remaining>0?Math.max(1,Math.round(inner*remaining/100)):0
  const cell=Math.min(d.barPixelSize,d.barHeight), step=cell+d.barPixelGap
  const cols=Math.max(1,Math.floor((inner+d.barPixelGap)/step)), rows=Math.max(1,Math.floor((d.barHeight+d.barPixelGap)/step))
  const gridWidth=cols*step-d.barPixelGap, gridHeight=rows*step-d.barPixelGap
  const gridX=x+Math.floor((inner-gridWidth)/2), gridY=y+d.barY+Math.floor((d.barHeight-gridHeight)/2)
  const numberSize=d.numberSize || (showBackground?44:56)
  const pillWidth=Math.min(163,Math.floor(inner/2)+9)
  const top=Math.min(0,d.titleY,percentageTop(numberSize)+d.valueOffset,d.pillY,d.barY,d.resetY)
  const bottom=Math.max(d.height,d.titleY+sansLine(d.titleSize),percentageTop(numberSize)+d.valueOffset+pixelLine(numberSize),d.pillY+d.pillHeight,d.barY+d.barHeight,d.resetY+sansLine(d.resetSize))
  return <g>
    <rect x={d.x} y={y} width={d.width} height={d.height} rx={d.radius} fill={showBackground ? colorHex(d.cardColor) : 'none'} />
    <ModuleLabel x={x} y={y+d.titleY} width={inner} size={d.titleSize} color={colorHex(d.mutedColor)}>{wireText(metric?.provider || '', 16)}</ModuleLabel>
    <ModuleLabel x={x} y={y+percentageTop(numberSize)+d.valueOffset} width={inner-pillWidth-7} size={numberSize} pixel color={colorHex(d.textColor)}>{available ? `${Math.round(remaining)}%` : '--'}</ModuleLabel>
    <foreignObject x={d.x+d.width-d.padding-pillWidth} y={y+d.pillY} width={pillWidth} height={d.pillHeight}>
      <div className="dp-card-pill" style={{height:d.pillHeight,lineHeight:`${d.pillHeight}px`,borderRadius:d.pillHeight/2,paddingInline:d.pillPadding,color:colorHex(d.textColor)}}>{wireText(metric?.label || fallback,16)}</div>
    </foreignObject>
    {d.barStyle===0?<>
      <rect x={x} y={y+d.barY} width={inner} height={d.barHeight} rx={d.barHeight/2} fill={colorHex(d.trackColor)} />
      {filledWidth>0&&<rect x={x} y={y+d.barY} width={filledWidth} height={d.barHeight} rx={Math.min(d.barHeight/2,filledWidth/2)} fill={barColor} />}
    </>:<>
      <defs>
        {[['track',colorHex(d.trackColor)],['fill',barColor]].map(([part,color])=><pattern key={part} id={`${patternId}-${part}`} patternUnits="userSpaceOnUse" x={gridX} y={gridY} width={step} height={step}>
          {d.barStyle===2?<circle cx={cell/2} cy={cell/2} r={cell/2} fill={color}/>:<rect width={cell} height={cell} fill={color}/>}
        </pattern>)}
        <clipPath id={`${patternId}-clip`}><rect x={x} y={y+d.barY} width={filledWidth} height={d.barHeight}/></clipPath>
        <clipPath id={`${patternId}-remaining`}><rect x={x+filledWidth} y={y+d.barY} width={inner-filledWidth} height={d.barHeight}/></clipPath>
      </defs>
      <rect x={gridX} y={gridY} width={gridWidth} height={gridHeight} fill={`url(#${patternId}-track)`} clipPath={`url(#${patternId}-remaining)`}/>
      {filledWidth>0&&<rect x={gridX} y={gridY} width={gridWidth} height={gridHeight} fill={`url(#${patternId}-fill)`} clipPath={`url(#${patternId}-clip)`}/>}
    </>}
    <ModuleLabel x={x} y={y+d.resetY} width={inner} size={d.resetSize} color={colorHex(d.mutedColor)}>{wireText(metric?.reset || 'Reset unavailable',24)}</ModuleLabel>
    <CardHit x={d.x} y={y+top} width={d.width} height={bottom-top} radius={d.radius} {...action}/>
  </g>
}

function CheckingIndicator({ animationMs, reduced, color, foreground }: { animationMs: number; reduced: boolean; color:number; foreground:number }) {
  const motionReduced = useReducedMotion(reduced)
  const clock = useRef({ animationMs, receivedAt: performance.now() })
  const [time, setTime] = useState(animationMs / 1000)
  useEffect(() => { clock.current = { animationMs, receivedAt: performance.now() } }, [animationMs])
  useEffect(() => {
    if (motionReduced) return
    let frame: number
    const update = (now: number) => {
      setTime((clock.current.animationMs + now - clock.current.receivedAt) / 1000)
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [motionReduced])
  return <ModuleLabel x={173} y={408} width={120} small align="center">
    <span className="dp-checking shimmer-text" role="status" style={{ backgroundImage: paletteShimmerGradient(time, motionReduced, color, foreground) }}>Checking</span>
  </ModuleLabel>
}

function RoonDashboard({dashboard,d,reduced,pending,onControl,onView,onSwipe}:{dashboard:Dashboard;d:DesignValues;reduced:boolean;pending?:boolean;onControl?:(action:string)=>void;onView?:(expanded:boolean)=>void;onSwipe?:(x:number,y:number)=>void}) {
  const expanded=dashboard.expanded===true
  const motionReduced=useReducedMotion(reduced)
  const {progress,chrome,angle}=useRoonMotion(expanded,!!dashboard.playing,d.animateArtwork===1,d.spinArtwork===1,motionReduced)
  const artClip=useId(), gesture=useRef<{x:number;y:number;id:number;at:number;travel:number}|null>(null)
  const size=d.artSize+(430-d.artSize)*progress, x=(466-size)/2, y=d.artY+(18-d.artY)*progress
  const radius=d.artRadius+(215-d.artRadius)*progress
  const imageSize=size*roonArtworkScale(size,radius,angle),centerX=x+size/2,centerY=y+size/2
  const toggle=()=>{if(!pending&&(dashboard.artId||expanded)&&onView)onView(!expanded)}
  return <>
    <g opacity={chrome} transform={`translate(0 ${(1-chrome)*12})`} aria-hidden={expanded}>
      <ModuleLabel x={58} y={d.titleY} width={350} align="center" size={d.titleSize} color={colorHex(d.textColor)}>{dashboard.track||'Nothing playing'}</ModuleLabel>
      <ModuleLabel x={58} y={d.artistY} width={350} align="center" size={d.artistSize} color={colorHex(d.mutedColor)}>{dashboard.artist||''}</ModuleLabel>
      {(['previous','playpause','next'] as const).map((action,index)=><foreignObject key={action} x={233+(index-1)*(d.controlSize+d.gap)-d.controlSize/2} y={d.controlsY} width={d.controlSize} height={d.controlSize}>
        <button className="dp-roon-control" style={{width:d.controlSize,height:d.controlSize,background:'transparent',color:colorHex(d.textColor)}} aria-label={action==='playpause'?(dashboard.playing?'Pause Roon':'Play Roon'):action==='previous'?'Previous track':'Next track'} disabled={expanded||progress>0||pending||!onControl||(action==='previous'&&!dashboard.canPrevious)||(action==='next'&&!dashboard.canNext)} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onControl?.(action)}}><svg viewBox="0 0 44 44" width={d.controlSize} height={d.controlSize} fill="currentColor" aria-hidden="true">{action==='playpause'?(dashboard.playing?<><rect x="12" y="8" width="6" height="28"/><rect x="26" y="8" width="6" height="28"/></>:<RoonIcon name="play" x={5} y={5} size={34}/>):<RoonIcon name={action} x={10} y={10} size={24}/>}</svg></button>
      </foreignObject>)}
    </g>
    <defs><clipPath id={artClip}><rect x={x} y={y} width={size} height={size} rx={radius}/></clipPath></defs>
    <g clipPath={`url(#${artClip})`}><rect x={x} y={y} width={size} height={size} fill="var(--device-surface,#151515)"/>
      {dashboard.artId?<image href={`/api/roon/art/${dashboard.artId}`} x={centerX-imageSize/2} y={centerY-imageSize/2} width={imageSize} height={imageSize} preserveAspectRatio="xMidYMid slice" transform={angle?`rotate(${angle} ${centerX} ${centerY})`:undefined}/>:null}
    </g>
    <foreignObject x={x} y={y} width={size} height={size}>
      <button className="dp-roon-art-hit" style={{width:'100%',height:'100%',borderRadius:radius}} aria-label={expanded?'Collapse album artwork':'Expand album artwork'} aria-pressed={expanded} disabled={pending||(!dashboard.artId&&!expanded)||!onView}
        onPointerDown={e=>{e.stopPropagation();if(e.isPrimary&&e.button===0){gesture.current={x:e.clientX,y:e.clientY,id:e.pointerId,at:performance.now(),travel:0};e.currentTarget.setPointerCapture(e.pointerId)}}}
        onPointerMove={e=>{const start=gesture.current;if(start&&start.id===e.pointerId)start.travel=Math.max(start.travel,Math.abs(e.clientX-start.x),Math.abs(e.clientY-start.y))}}
        onPointerUp={e=>{e.stopPropagation();const start=gesture.current;gesture.current=null;if(!start||start.id!==e.pointerId||performance.now()-start.at>1500)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;onSwipe?.(dx,dy);if(start.travel<12&&Math.abs(dx)<12&&Math.abs(dy)<12)toggle()}}
        onPointerCancel={()=>{gesture.current=null}} onLostPointerCapture={()=>{gesture.current=null}}
        onClick={e=>{e.stopPropagation();if(e.detail===0)toggle()}}/>
    </foreignObject>
  </>
}

function ModuleDashboard({ module, dashboard, online, animationMs, reduced, showCardBackgrounds, design, onRoonControl, onRoonView, onOpenCard, onSwipe, pending }: { onRoonView?:(expanded:boolean)=>void; onRoonControl?:(action:string)=>void; onOpenCard?:(request:OpenCardRequest)=>void; onSwipe:(x:number,y:number)=>void; pending?:boolean; module: 'usage' | 'hey' | 'clock' | 'roon'; dashboard?: Dashboard; online: boolean; animationMs: number; reduced: boolean; showCardBackgrounds: boolean; design?:Partial<Designs> }) {
  const d=designFor(design,module)
  const title = wireText(dashboard?.title || moduleNames[module], 32)
  const ready = online && dashboard?.status === 'ready'
  const errorTitle = !online ? 'Disconnected' : ({
    loading: 'Connecting', auth: 'Sign in needed', error: 'Could not refresh',
  } as Record<string, string>)[dashboard?.status ?? ''] || 'Not connected'
  const detail = wireText(!online ? 'Reconnect the desktop bridge' : dashboard?.status === 'loading' ? moduleNames[module] : dashboard?.detail || 'Set up this module in the playground')
  const usageWindows = [dashboard?.primary, dashboard?.secondary]
    .map((metric, index) => ({ metric, slot:index, fallback: index ? 'Weekly' : 'Session' }))
    .filter(({ metric }) => metric && (metric.label || metric.reset || Number.isFinite(metric.remaining)))
  const mailItems = dashboard?.items?.slice(0, d.rows) ?? []

  return <svg className="dp-module-screen" viewBox="0 0 466 466" role={module==='clock'?'img':'group'} aria-label={module === 'clock' && ready ? `Clock, ${dashboard?.time}, ${dashboard?.weekday || ''}` : `${title} ${module === 'usage' ? 'usage' : module === 'hey' ? 'mail' : module === 'roon' ? 'music' : 'clock'} dashboard`}>
    {ready && module === 'roon' && <RoonDashboard dashboard={dashboard!} d={d} reduced={reduced} pending={pending} onControl={onRoonControl} onView={onRoonView} onSwipe={onSwipe}/>}
    {ready && module === 'clock' && <>
      <foreignObject x={d.x} y={d.y} width={d.width} height={pixelLine(d.timeSize)}>
        <div className="dp-clock-time" style={{fontSize:d.timeSize,lineHeight:`${pixelLine(d.timeSize)}px`,textAlign:(['left','center','right'] as const)[d.align],color:colorHex(d.textColor)}}>{dashboard?.time?.split('').map((char,index)=><span key={index} className={char===':'&&dashboard.blinkSeparator&&!reduced?'dp-clock-blink':undefined}>{char}</span>)}</div>
      </foreignObject>
      {dashboard?.weekday && <ModuleLabel x={d.x} y={d.dayY} width={d.width} size={d.daySize} color={colorHex(d.mutedColor)} align={(['left','center','right'] as const)[d.align]}>{dashboard.weekday}</ModuleLabel>}
    </>}
    {ready && module === 'usage' && <>
      {usageWindows.map(({ metric, fallback, slot }, index) => <UsageCard key={fallback} metric={metric}
        d={d} y={(usageWindows.length===1?158:(showCardBackgrounds?75:83)+index*(d.height+(showCardBackgrounds?24:8)+d.rowGap))+d.offsetY} fallback={fallback} showBackground={showCardBackgrounds}
        action={{request:dashboard?.openToken?{module:'usage',index:slot,token:dashboard.openToken}:undefined,label:`Open ${metric?.provider || 'provider'} ${metric?.label || fallback} usage in your browser`,disabled:!!pending||!metric?.openable,onOpen:onOpenCard,onSwipe}} />)}
    </>}
    {ready && module === 'hey' && <>
      {mailItems.length === 0 && <ModuleLabel x={73} y={205} width={320} align="center">{dashboard?.detail || 'You are all caught up'}</ModuleLabel>}
      {mailItems.map((item, index) => {
        const y = d.y + index * (d.height+d.gap)
        const top=Math.min(0,d.senderY,d.subjectY)
        const bottom=Math.max(d.height,d.senderY+sansLine(d.senderSize),d.subjectY+d.lines*sansLine(d.subjectSize))
        return <g key={index}>
          <rect x={d.x} y={y} width={d.width} height={d.height} rx={d.radius} fill={showCardBackgrounds ? colorHex(d.cardColor) : 'none'} />
          <ModuleLabel x={d.x+d.padding} y={y+d.senderY} width={d.width-2*d.padding} size={d.senderSize} color={colorHex(d.textColor)}>{item.sender}</ModuleLabel>
          <ModuleLabel x={d.x+d.padding} y={y+d.subjectY} width={d.width-2*d.padding} size={d.subjectSize} color={colorHex(d.mutedColor)} lines={d.lines} truncate>{item.subject}</ModuleLabel>
          <CardHit x={d.x} y={y+top} width={d.width} height={bottom-top} radius={d.radius}
            request={dashboard?.openToken?{module:'hey',index,token:dashboard.openToken}:undefined} label={`Open email from ${item.sender}: ${item.subject}`} disabled={!!pending||!item.openable} onOpen={onOpenCard} onSwipe={onSwipe}/>
        </g>
      })}
    </>}
    {ready && module !== 'clock' && dashboard?.refreshing && <CheckingIndicator animationMs={animationMs} reduced={reduced} color={d.mutedColor} foreground={d.textColor} />}
    {!ready && <>
      <ModuleLabel x={73} y={205} width={320} align="center">{errorTitle}</ModuleLabel>
      <ModuleLabel x={83} y={240} width={300} small muted align="center" lines={2}>{detail}</ModuleLabel>
    </>}
  </svg>
}

function Hint({ text, children }: { text: string; children: ReactElement }) {
  return <Tooltip><TooltipTrigger render={children} /><TooltipContent side="bottom">{text}</TooltipContent></Tooltip>
}

export default function DevicePreview({ snapshot, localAnimation, localReplay = 0, onModule, onLive, onUsagePage, onHeyPage, onOpenCard, onRoonControl, onRoonView, pending = false, online = false }: DevicePreviewProps) {
  const panel = previewDisplay(snapshot?.device.profile)
  const canvasSide = Math.min(panel.width, panel.height)
  const titleId = useId()
  const local = localAnimation !== undefined && !snapshot?.attention?.active
  const localClock = useMemo(() => ({ changedAt: Date.now(), animationMs: performance.now() }), [localAnimation, localReplay])
  const attention = !local && online ? snapshot?.attention?.active : null
  const module: ModuleId = local ? 'face' : snapshot && moduleIds.includes(snapshot.module) ? snapshot.module : 'face'
  const enabled = snapshot?.settings.device.moduleOrder.filter((id): id is ModuleId =>
    moduleIds.includes(id as ModuleId) && snapshot.settings.modules[id as ModuleId].enabled) ?? ['face']
  const moduleIndex = enabled.indexOf(module)
  const display = snapshot?.display
  const semanticState = local ? (localAnimation?.startsWith('grok:') ? 'idle' : localAnimation || 'idle') : online ? display?.state || 'disconnected' : 'disconnected'
  const animation = local ? localAnimation?.startsWith('grok:') ? localAnimation : null : online ? display?.animation : null
  const pose = local ? semanticState : online ? display?.expression || semanticState : 'disconnected'
  const caption = attention ? attention.title : wireText(local ? animationName(localAnimation || 'idle') : online ? display?.label || 'Connecting' : 'Disconnected')
  const subtitle = attention ? attention.description : wireText(local ? 'Preview' : online ? display?.name || '' : 'Waiting for host')
  const shimmer = semanticState === 'working' && !animation
  const nameShimmer = !local && online && display?.nameShimmer === true
  const forcedPose = Boolean(snapshot && (snapshot.expression !== null || snapshot.display.expression))
  const gap = snapshot?.layout.textGap ?? 8
  const pointer = snapshot?.pointer
  const look = online && pointer?.enabled && pointer.status === 'active' ? { x: pointer.x, y: pointer.y } : null
  const showNavigation = snapshot?.settings.device.showModuleNavigation === true
  const swipeEnabled = snapshot?.settings.device.swipeEnabled ?? true
  const canSwitch = !attention && !pending && online && enabled.length > 1
  const canPage = !pending && online && (module === 'usage' || module === 'hey') && display?.dashboard?.status === 'ready' && (display.dashboard.pageCount ?? 1) > 1
  const changePage = (direction: number) => module === 'hey' ? onHeyPage(direction) : onUsagePage(direction)
  const showLive = !attention && (local || Boolean(snapshot && snapshot.expression !== null))
  const gesture = useRef<{ id: number; x: number; y: number; at: number } | null>(null)
  const palette=snapshot?.deviceAppearance?.palette || devicePaletteDefaults[snapshot?.settings.deviceAppearance?.mode==='light'?'light':'dark']
  const resolvedDesign=resolveDesign(snapshot?.settings.design || defaultDesign,palette)
  const faceDesign=designFor(resolvedDesign,'face')
  const style = { '--device-background':colorHex(palette.background),'--device-foreground':colorHex(palette.foreground),'--device-muted':colorHex(palette.muted),'--device-surface':colorHex(palette.surface),'--device-accent':colorHex(palette.accent),'--device-track':colorHex(palette.track), '--status-top':395-27-gap+faceDesign.titleOffset, '--title-width':faceDesign.titleWidth, '--title-size':faceDesign.titleSize, '--title-line':sansLine(faceDesign.titleSize), '--title-color':colorHex(faceDesign.textColor), '--name-top':faceDesign.nameY, '--name-width':faceDesign.nameWidth, '--name-size':faceDesign.nameSize, '--name-line':sansLine(faceDesign.nameSize), '--name-color':colorHex(faceDesign.mutedColor), touchAction:canPage?'none':'pan-y' } as CSSProperties

  const switchModule = (direction: number) => {
    if (!canSwitch) return
    const current = moduleIndex < 0 ? enabled.indexOf(snapshot?.module || 'face') : moduleIndex
    onModule(enabled[(Math.max(0, current) + direction + enabled.length) % enabled.length]!)
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((!canPage && !(swipeEnabled && canSwitch)) || !event.isPrimary || event.button !== 0) return
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const swipe = (x:number,y:number) => {
    if (canPage && Math.abs(y) >= 55 && Math.abs(y) > Math.abs(x) * 1.25) changePage(y < 0 ? 1 : -1)
    else if (swipeEnabled && Math.abs(x) >= 70 && Math.abs(x) > Math.abs(y) * 1.25) switchModule(x < 0 ? 1 : -1)
  }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    gesture.current = null
    if (!start || start.id !== event.pointerId || performance.now() - start.at > 1500) return
    const x = event.clientX - start.x
    const y = event.clientY - start.y
    swipe(x,y)
  }

  return <section className="device-preview" aria-labelledby={titleId}>
    <header className="dp-heading">
      <h2 id={titleId}>Device preview</h2>
    </header>

    <div className="dp-stage">
      <div className="dp-hardware" data-shape={panel.shape} style={{aspectRatio:'auto'}} role="group" aria-label={local ? 'Local animation preview' : 'Device screen'}>
        <div className="dp-display" data-shape={panel.shape} style={{aspectRatio:`${panel.width} / ${panel.height}`,background:colorHex(palette.background)}}>
        <div className="device-screen" dir="ltr" style={{...style,position:'absolute',width:`${canvasSide/panel.width*100}%`,height:`${canvasSide/panel.height*100}%`,left:'50%',top:'50%',transform:'translate(-50%, -50%)',borderRadius:panel.shape==='round'?'50%':0}} tabIndex={canPage?0:undefined}
          aria-label={module==='clock'?'Clock':module==='roon'?'Roon playback':module!=='face'?`${module==='hey'?'Mailbox list':'Usage cards'}. Use the up and down arrow keys to browse.`:undefined}
          onKeyDown={event=>{if(canPage&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();changePage(event.key==='ArrowDown'?1:-1)}}}
          onPointerDown={pointerDown} onPointerUp={pointerUp}
          onPointerCancel={() => { gesture.current = null }} onLostPointerCapture={() => { gesture.current = null }}>
          {attention?.detail ? null : module === 'face' ? <Face
            palette={palette} backgroundColor={palette.background} foregroundColor={palette.foreground} faceScale={faceDesign.scale ?? 100} textColor={faceDesign.textColor} mutedColor={faceDesign.mutedColor} animation={animation} state={pose} statusLabel={shimmer ? caption : undefined} nameLabel={nameShimmer ? subtitle : undefined}
            changedAt={local ? localClock.changedAt : snapshot?.changedAt ?? 0}
            animationMs={local ? localClock.animationMs : snapshot?.animationMs ?? 0}
            ageMs={local ? 0 : snapshot?.ageMs ?? 0}
            reduced={snapshot?.settings.appearance.reducedMotion}
            preview={local || forcedPose} look={look}
          /> : <ModuleDashboard module={module} dashboard={display?.dashboard} online={online}
            animationMs={snapshot?.animationMs ?? 0} reduced={snapshot?.settings.appearance.reducedMotion ?? false}
            showCardBackgrounds={snapshot?.settings.device.showCardBackgrounds === true} design={resolvedDesign} onRoonControl={onRoonControl} onRoonView={onRoonView} onOpenCard={onOpenCard} onSwipe={swipe} pending={pending} />}
          {module === 'face' && !attention?.detail && !shimmer && <div className="screen-caption"><span>{caption}</span></div>}
          {module === 'face' && !attention?.detail && !nameShimmer && <div className="screen-name">{subtitle}</div>}
          {attention && <AttentionOverlay key={`${attention.id}:${attention.revision}`} request={attention} detail={attention.detail} pending={pending || !online}/>}
          {!attention && showNavigation && enabled.length > 1 && <div className="dp-screen-pages" aria-hidden="true">
            {enabled.map(id => <i key={id} data-active={id === module} />)}
          </div>}
        </div>
        </div>
      </div>
      <div className="dp-stage-meta">
        <span className="dp-mode" data-local={local}>{local ? <ScanFace aria-hidden="true" /> : <Radio aria-hidden="true" />}{local ? 'Local preview' : 'Live device'}</span>
        <span className="dp-resolution">{panel.width} x {panel.height}</span>
      </div>
    </div>

    {showNavigation && <TooltipProvider delay={500}>
      <div className="dp-module-controls" data-count={enabled.length} aria-label="Device modules">
        <Hint text="Previous module"><Button variant="ghost" size="icon-sm" disabled={!canSwitch} aria-label="Previous module" onClick={() => switchModule(-1)}><ArrowLeft /></Button></Hint>
        <div className="dp-module-pills">
          {enabled.map(id => {
            const Icon = moduleIcons[id]
            return <Hint key={id} text={`Show ${moduleNames[id]} on the device`}>
              <Button variant="ghost" size="sm" className="dp-module-pill" aria-label={`Show ${moduleNames[id]} on the device`}
                aria-pressed={!local && id === module} disabled={pending || !online || !!attention}
                onClick={() => { if (local || id !== module) onModule(id) }}>
                <Icon aria-hidden="true" /><span>{shortNames[id]}</span>
              </Button>
            </Hint>
          })}
        </div>
        <Hint text="Next module"><Button variant="ghost" size="icon-sm" disabled={!canSwitch} aria-label="Next module" onClick={() => switchModule(1)}><ArrowRight /></Button></Hint>
      </div>
    </TooltipProvider>}
    {(showNavigation || showLive) && <div className="dp-bottom">
      {(showNavigation || local) && <p>{local ? 'Only you can see this preview.' : enabled.length > 1 ? swipeEnabled ? 'Swipe the screen to switch modules.' : 'Choose a module above to switch.' : 'Add modules to make this device your own.'}</p>}
      {showLive && <Button variant="outline" size="sm" onClick={onLive} disabled={pending || (!local && !online)}><RotateCcw data-icon="inline-start" />Return to live</Button>}
    </div>}
  </section>
}
