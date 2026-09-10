export const SPEED_DIAL_MAX_SLOTS = 13;
export const SPEED_DIAL_ATLAS_ICON_SIZE = 32;

const controls = [{x:205,y:416,width:56,height:22},{x:181,y:444,width:104,height:8}];
function clearsControls(slot) {
  const radius = slot.width / 2, cx = slot.x + radius, cy = slot.y + radius;
  return controls.every((rect, index) => (cx - Math.max(rect.x, Math.min(cx, rect.x + rect.width)))**2 +
    (cy - Math.max(rect.y, Math.min(cy, rect.y + rect.height)))**2 >= (radius + (index === 0 ? 16 : 2))**2);
}
const defaults = {buttonSize:96,iconSize:48,labelSize:18,gap:16,offsetY:0,rowHeight:76};
export const speedDialPageSize = (config, design = defaults) => speedDialLayout(config, design).slots.length;

function gridSlot(x, y, size, gap, labelHeight, config, design) {
  const iconSize = Math.min(design.iconSize, size - 20);
  return {x,y,width:size,height:size,radius:Math.floor(size/2),
    icon:{x:x+Math.floor((size-iconSize)/2),y:y+Math.floor((size-iconSize)/2),size:iconSize},
    label:config.showLabels?{x:x-Math.floor(gap/2)+2,y:y+size+8,width:size+gap-4,height:labelHeight,align:'center'}:null,
    status:{x:x+size-20,y:y+6,size:14}};
}

function packedSlots(config, design, labelHeight) {
  const round = config.screenShape !== 'rectangular', gap = design.gap;
  const labelSpace = config.showLabels ? labelHeight + 8 : 0;
  const dense = round && !config.showLabels;
  const bottomLimit = dense ? 454 : 408, capacity = dense ? SPEED_DIAL_MAX_SLOTS : 9;
  let size = Math.min(design.buttonSize, Math.floor((384 - 2 * gap) / 3) - labelSpace);
  const center = Math.round((dense ? 206 : 216) - labelSpace / 2) + design.offsetY;
  // Fit five rows of large circles above the page counter before adding four side circles.
  if (dense) while (size > 48) {
    const pitch = size+gap, row = Math.ceil(Math.sqrt(pitch**2-Math.floor(pitch/2)**2));
    const halfPixel = (size%2)/2, top = center+halfPixel-2*row;
    if (halfPixel**2+(top-233)**2<=(221-size/2)**2 && center+2*row+Math.ceil(size/2)<=400) break;
    size--;
  }
  const pitchX = size + gap;
  const pitchY = dense ? Math.ceil(Math.sqrt(pitchX**2 - Math.floor(pitchX/2)**2)) : size + labelSpace + gap;
  const candidates = [];
  for (let row = -4; row <= 4; row++) for (let col = -4; col <= 4; col++) {
    const offset = (col + (round && Math.abs(row) % 2 ? .5 : 0)) * pitchX;
    if (dense && (Math.abs(row)>2 || Math.abs(offset)>(2-Math.abs(row))*pitchX/2)) continue;
    const cx = dense ? 233 + Math.sign(offset)*Math.round(Math.abs(offset)) : Math.round(233+offset);
    const cy = center + row * pitchY;
    const slot = gridSlot(Math.round(cx-size/2), Math.round(cy-size/2), size, gap, labelHeight, config, design);
    const right = slot.x + size, bottom = slot.y + size;
    if (slot.x < 12 || right > 454 || slot.y < 12 || bottom > bottomLimit || (dense && !clearsControls(slot))) continue;
    if (round && (slot.x + size/2 - 233)**2 + (slot.y + size/2 - 233)**2 > (221 - size/2)**2) continue;
    const label = slot.label;
    if (label && (label.x < 12 || label.x+label.width > 454 || label.y+label.height > 408 ||
      (round && [label.x,label.x+label.width].some(x => [label.y,label.y+label.height].some(y => (x-233)**2+(y-233)**2 > 221**2))))) continue;
    candidates.push({slot,cx,cy,distance:(cx-233)**2+(cy-center)**2});
  }
  candidates.sort((a,b)=>a.distance-b.distance || a.cy-b.cy || a.cx-b.cx);
  // Keep opposite pairs together when the atlas capacity limits a dense layout.
  const chosen = [], used = new Set();
  for (const point of candidates) {
    if (used.has(point)) continue;
    const opposite = candidates.find(other=>other.cx===466-point.cx && other.cy===2*center-point.cy);
    if (dense && !opposite) continue;
    const pair = opposite && opposite!==point ? [point,opposite] : [point];
    if (chosen.length+pair.length > capacity) continue;
    for (const item of pair) {if(!used.has(item)){chosen.push(item);used.add(item);}}
  }
  // Grow from neighbouring circles, not the rim. Each new button nests against at least two existing buttons.
  if (dense && chosen.length > 1) {
    const middle = chosen[0].slot, cx = middle.x + size/2, cy = middle.y + size/2;
    const fits = s => {
      const x = s.x+s.width/2, y = s.y+s.width/2;
      if ((x-233)**2+(y-233)**2>(221-s.width/2)**2 || !clearsControls(s)) return false;
      let neighbours = 0;
      for (const {slot:other} of chosen) {
        const spacing = (s.width+other.width)/2+gap;
        const distance = (x-other.x-other.width/2)**2+(y-other.y-other.width/2)**2;
        if (distance<spacing**2) return false;
        if (distance<=(spacing+1)**2) neighbours++;
      }
      return neighbours>=2;
    };
    while (chosen.length+2<=capacity) {
      let best;
      for (let edgeSize=Math.max(48,Math.floor(size*.75)); edgeSize>=48 && !best; edgeSize--) {
        for (let i=0;i<chosen.length;i++) for (let j=i+1;j<chosen.length;j++) {
          const a=chosen[i].slot, b=chosen[j].slot, ax=a.x+a.width/2, ay=a.y+a.width/2;
          const dx=b.x+b.width/2-ax, dy=b.y+b.width/2-ay, distance=dx*dx+dy*dy;
          // Half a pixel allows rounding while keeping both gaps within one pixel of the setting.
          const ra=(a.width+edgeSize)/2+gap+.5, rb=(b.width+edgeSize)/2+gap+.5;
          if (!distance || distance>(ra+rb)**2 || distance<(ra-rb)**2) continue;
          const along=(ra*ra-rb*rb+distance)/(2*distance), height=Math.sqrt(Math.max(0,ra*ra/distance-along*along));
          for (const side of [-1,1]) {
            const x=Math.round(ax+along*dx+side*height*dy-edgeSize/2), y=Math.round(ay+along*dy-side*height*dx-edgeSize/2);
            const edges=[{x,y,width:edgeSize},{x:2*cx-x-edgeSize,y:2*cy-y-edgeSize,width:edgeSize}];
            if (y>edges[1].y || (y===edges[1].y && x>edges[1].x) || !edges.every(fits) ||
              (x-edges[1].x)**2+(y-edges[1].y)**2<(edgeSize+gap)**2) continue;
            const radius=(x+edgeSize/2-cx)**2+(y+edgeSize/2-cy)**2;
            if (!best || radius<best.radius || (radius===best.radius && (y<best.y || (y===best.y && x<best.x)))) best={edges,radius,x,y};
          }
        }
      }
      if (!best) break;
      for (const edge of best.edges) chosen.push({slot:gridSlot(edge.x,edge.y,edge.width,gap,0,config,
        {...design,iconSize:Math.max(24,Math.floor(design.iconSize*edge.width/size))})});
    }
  }
  // Fill the centre first, followed by opposite pairs. Partial pages stay balanced.
  let dx=0,dy=0;
  const visible=chosen.slice(0,config.buttonCount??chosen.length).map(point=>point.slot);
  // Centre the visible group without changing packing, button order or page capacity.
  if (dense && config.pageCount === 1 && visible.length) {
    const left=Math.min(...visible.map(s=>s.x)),right=Math.max(...visible.map(s=>s.x+s.width));
    const top=Math.min(...visible.map(s=>s.y)),bottom=Math.max(...visible.map(s=>s.y+s.height));
    dx=Math.round(233-(left+right)/2);dy=Math.round(233+design.offsetY-(top+bottom)/2);
  }
  return chosen.map(({slot})=>{
    slot.x+=dx;slot.y+=dy;slot.icon.x+=dx;slot.icon.y+=dy;slot.status.x+=dx;slot.status.y+=dy;
    return slot;
  });
}

// Logical 466px coordinates, mirrored by speed_dial.c on the display.
export function speedDialLayout(config, design = defaults) {
  design = {...defaults,...design};
  const count = config.layout === 'list' ? config.listRows : config.gridSize, gap = design.gap;
  const labelHeight = Math.ceil(design.labelSize * 1.25);
  const center = 225 + design.offsetY;
  const slots = [];
  if (config.layout === 'list') {
    const height = Math.min(design.rowHeight, Math.floor((328 - (count - 1) * gap) / count));
    const top = Math.round(center - (height * count + gap * (count - 1)) / 2);
    const size = Math.min(design.iconSize, height - 16);
    for (let i = 0; i < count; i++) {
      const y = top + i * (height + gap);
      slots.push({x:73,y,width:320,height,radius:20,
        icon:{x:89,y:y + Math.floor((height-size)/2),size},
        label:{x:103+size,y:y+Math.floor((height-labelHeight)/2),width:254-size,height:labelHeight,align:'left'},
        status:{x:363,y:y+Math.floor((height-14)/2),size:14}});
    }
  } else if (count === 0) {
    slots.push(...packedSlots(config, design, labelHeight));
  } else {
    const rows = count / 2;
    const labelSpace = config.showLabels ? labelHeight + 8 : 0;
    const size = Math.min(design.buttonSize,count===6?84:112,Math.floor((340-(rows-1)*gap)/rows)-labelSpace);
    const height = size + labelSpace;
    const left = Math.round(233-(size*2+gap)/2), top = Math.round(center-(rows*height+(rows-1)*gap)/2);
    for (let i=0;i<count;i++) {
      const x=left+(i%2)*(size+gap), y=top+Math.floor(i/2)*(height+gap);
      slots.push(gridSlot(x,y,size,gap,labelHeight,config,design));
    }
  }
  return {slots,page:{x:0,y:416,width:466,height:22}};
}
