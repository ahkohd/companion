import {useEffect,useId,useRef,useState} from 'react'
import {Button} from './ui/button'
import {Input} from './ui/input'
import {Slider} from './ui/slider'
import './physical-rotation.css'

function degrees(text:string) {
  if(!/^\d{1,3}$/.test(text))return null
  const value=Number(text)
  return value<=359?value:null
}

export default function PhysicalRotation({value,disabled,onSave}:{value:number;disabled:boolean;onSave:(value:number)=>Promise<boolean>}) {
  const labelId=useId(),errorId=useId()
  const [draft,setDraft]=useState(String(value)),[saving,setSaving]=useState(false),[error,setError]=useState('')
  const draftRef=useRef(draft),saved=useRef(value),busy=useRef(false),editing=useRef(false),mounted=useRef(true)
  const timer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const clearTimer=()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null}}
  const update=(text:string)=>{draftRef.current=text;setDraft(text);setError('')}
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimer()}},[])
  useEffect(()=>{const previous=saved.current;saved.current=value;if(!busy.current&&(!editing.current||draftRef.current===String(previous)))update(String(value))},[value])

  async function commit(text:string) {
    clearTimer()
    if(disabled||busy.current)return
    const next=degrees(text)
    if(next===null){setError('Enter a whole number from 0 to 359.');return}
    update(String(next))
    if(next===saved.current)return
    const before=saved.current
    busy.current=true;setSaving(true)
    try {
      const success=await onSave(next)
      if(success&&(saved.current===before||saved.current===next))saved.current=next
      if(mounted.current){update(String(saved.current));if(!success)setError('Rotation was not saved. Try again.')}
    } catch {
      if(mounted.current){update(String(saved.current));setError('Rotation was not saved. Try again.')}
    } finally {busy.current=false;if(mounted.current)setSaving(false)}
  }

  const locked=disabled||saving,angle=degrees(draft)??saved.current
  return <div className="physical-rotation" onFocusCapture={()=>{editing.current=true}} onPointerCancel={()=>{clearTimer();update(String(saved.current))}}
    onBlur={event=>{if(event.relatedTarget&&event.currentTarget.contains(event.relatedTarget))return;editing.current=false;void commit(draftRef.current)}}>
    <span id={labelId} className="sr-only">Physical display rotation</span>
    <div className="physical-rotation-value">
      <Slider aria-labelledby={labelId} min={0} max={359} step={1} value={[angle]} disabled={locked}
        onValueChange={values=>{clearTimer();update(String(typeof values==='number'?values:values[0]))}}
        onValueCommitted={(values,details)=>{const text=String(typeof values==='number'?values:values[0]);clearTimer();if(details.reason==='keyboard')timer.current=setTimeout(()=>void commit(text),150);else void commit(text)}}/>
      <div className="physical-rotation-number"><Input type="number" min={0} max={359} step={1} inputMode="numeric" aria-label="Rotation in degrees" aria-describedby={error?errorId:undefined} aria-invalid={!!error} value={draft} disabled={locked}
        onChange={event=>{clearTimer();update(event.target.value)}}
        onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void commit(draftRef.current)}else if(event.key==='Escape'){event.preventDefault();clearTimer();update(String(saved.current))}}}/><span aria-hidden="true">deg</span></div>
    </div>
    <div className="physical-rotation-presets" role="group" aria-label="Rotation presets">{[0,90,180,270].map(preset=><Button key={preset} variant="outline" size="xs" disabled={locked} aria-pressed={angle===preset} aria-label={`Rotate physical display to ${preset} degrees`} onClick={()=>void commit(String(preset))}>{preset}</Button>)}</div>
    {error&&<p id={errorId} className="physical-rotation-error" role="status">{error}</p>}
  </div>
}
