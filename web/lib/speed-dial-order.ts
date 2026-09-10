import type { SpeedDialButton } from './studio'

export function reorderSpeedDialButtons(buttons:SpeedDialButton[],id:string,targetId:string,after:boolean) {
  const from=buttons.findIndex(button=>button.id===id),to=buttons.findIndex(button=>button.id===targetId)
  if(from<0||to<0||from===to)return buttons
  const insertion=to+(after?1:0)-(from<to?1:0)
  if(insertion===from)return buttons
  const reordered=[...buttons]
  reordered.splice(insertion,0,...reordered.splice(from,1))
  return reordered
}
