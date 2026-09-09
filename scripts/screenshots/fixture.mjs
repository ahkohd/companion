import { FaceStore } from '../../bridge/store.mjs';
import { mergeSettings } from '../../bridge/studio-settings.mjs';
import board from '../../shared/boards/waveshare-1.75-b.json' with {type:'json'};

export const CAPTURE_TIME = Date.parse('2026-09-09T16:20:00Z');

// Synthetic data only. This module never starts the bridge or reads user settings.
export function showcaseSnapshot(module = 'face', theme = 'dark') {
  const store = new FaceStore();
  store.setSettings(mergeSettings(store.settings, {
    appearance:{theme, reducedMotion:true},
    device:{activeModule:module, followMouse:false},
    deviceAppearance:{mode:theme},
    modules:{roon:{enabled:true}, audio:{enabled:true}},
  }));
  store.ingest([
    {pane_id:'demo-build',agent:'Codex',name:'Build the landing page',cwd:'/sample/companion',agent_status:'working'},
    {pane_id:'demo-review',agent:'Claude',name:'Review the latest changes',cwd:'/sample/companion',agent_status:'done'},
    {pane_id:'demo-tests',agent:'Codex',name:'Run the test suite',cwd:'/sample/companion',agent_status:'working'},
    {pane_id:'demo-docs',agent:'Claude',name:'Update the documentation',cwd:'/sample/companion',agent_status:'idle'},
  ]);
  const ready = {status:'ready', installed:true, refreshing:false, version:null, error:null, updatedAt:CAPTURE_TIME};
  store.setSources({
    usage:{...ready, providers:[{id:'codex',label:'Codex',plan:'Pro',windows:[
      {id:'session',label:'Session',usedPercent:27,resetAt:CAPTURE_TIME+8_040_000},
      {id:'weekly',label:'Weekly',usedPercent:58,resetAt:CAPTURE_TIME+367_200_000},
    ]}]},
    hey:{...ready, selectedBox:'imbox',hasMore:false,items:[
      {id:'sample-mail-1',sender:'Alex Morgan',subject:'A few thoughts on the new design'},
      {id:'sample-mail-2',sender:'Studio team',subject:'Ready for your review'},
    ]},
    roon:{...ready,player:'roon',playerName:'Roon',players:[{id:'roon',name:'Roon',status:'ready'}],coreName:'Music server',zones:[{id:'sample-zone',name:'Desk',state:'playing'}],zoneId:'sample-zone',track:'A little music',artist:'Sample artist',playing:true,canPrevious:true,canNext:true,artId:null},
    audio:{status:'ready',error:null,scope:'output',deviceId:1,deviceName:'Mac speakers',volume:65,muted:false,canVolume:true,canMute:true,inputs:[{id:2,name:'Desk microphone'}],outputs:[{id:1,name:'Mac speakers'}],devices:[{id:1,name:'Mac speakers',active:true}],pickerOpen:false,pageIndex:0,pageCount:2,deviceCount:1,nextDeviceId:1},
  });
  store.setDevice({profile:board,status:'connected',port:'/dev/cu.companion-demo',error:null,lastAck:CAPTURE_TIME});
  const result = store.snapshot();
  result.changedAt = CAPTURE_TIME;
  result.updatedAt = CAPTURE_TIME;
  result.animationMs = 0;
  result.ageMs = 0;
  // These depend on wall time in the live store. Keep the demonstration fixed.
  if (module === 'usage') {
    result.display.dashboard.primary.reset = 'Resets in 2h 14m';
    result.display.dashboard.secondary.reset = 'Resets in 4d 6h';
  }
  return result;
}
