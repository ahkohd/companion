import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { setImmediate as turn } from 'node:timers/promises';
import { SpeedDial, SpeedDialIcons, validateSpeedDial, actionCommand, executeSpeedDialAction, makeSpeedDialAtlas } from '../bridge/speed-dial.mjs';
import { defaultSettings, mergeSettings, StudioSettings } from '../bridge/studio-settings.mjs';
import { FaceStore } from '../bridge/store.mjs';
import { DeviceLink } from '../bridge/device.mjs';

const button = (id = 'test') => ({id,label:'Test',enabled:true,color:null,icon:{kind:'builtin',value:'zap',assetId:'a'.repeat(64)},actions:[{type:'shell',value:'first'},{type:'shell',value:'second'}]});
function setup(execute) {
  const settings = defaultSettings(); settings.modules.speedDial.enabled = true; settings.device.activeModule = 'speedDial'; settings.modules.speedDial.buttons = [button()];
  const dial = new SpeedDial({icons:{read:async()=>null},execute}); dial.configure(settings); return {dial,settings};
}
async function finished(dial) { for (let i=0; i<100; i++) { if (!dial.running.size) return; await turn(); } assert.fail('Actions did not finish'); }

test('Speed Dial validates IDs, labels, actions and image references', () => {
  const {settings,dial}=setup(); dial.stop();
  assert.doesNotThrow(()=>validateSpeedDial(settings.modules.speedDial));
  for (const patch of [{id:'../escape'},{label:'A'.repeat(25)},{label:'\u4e00'.repeat(24)},{icon:{kind:'image',value:'bad',assetId:'../../file'}},{actions:[]},{actions:[{type:'unknown',value:'value'}]},{actions:[{type:'url',value:'javascript:alert(1)'}]}]) {
    assert.throws(()=>mergeSettings(settings,{modules:{speedDial:{buttons:[{...button(),...patch}]}}}));
  }
  assert.throws(()=>mergeSettings(settings,{modules:{speedDial:{buttons:[button(),button()]}}}));
});

test('upgrading six-module saved settings preserves user designs and app preferences', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'companion-dial-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const settings=defaultSettings();delete settings.modules.speedDial;delete settings.design.speedDial;settings.device.moduleOrder=settings.device.moduleOrder.filter(id=>id!=='speedDial');settings.design.face.titleSize=27;settings.device.rotation=85;
  const filePath=path.join(dir,'settings.json');await writeFile(filePath,JSON.stringify(settings));
  const saved=new StudioSettings(new FaceStore(),{filePath});await saved.load();
  assert.equal(saved.value.device.rotation,85);assert.equal(saved.value.design.face.titleSize,27);assert.equal(saved.value.modules.speedDial.enabled,false);assert.equal(saved.value.device.moduleOrder.at(-1),'speedDial');
});

test('configuration never runs commands; deliberate runs are ordered and duplicates refused', async t => {
  const seen=[];let release;
  const {dial,settings}=setup(async action=>{seen.push(action.value);if(action.value==='first')await new Promise(resolve=>{release=resolve});return action.value+'\n'});t.after(()=>dial.stop());
  assert.deepEqual(seen,[]);dial.run({id:'test',token:dial.openToken});assert.equal(dial.snapshot().results.test.status,'running');assert.throws(()=>dial.run({id:'test'}),/already/);release();await finished(dial);
  assert.deepEqual(seen,['first','second']);assert.equal(dial.results.test.status,'success');assert.equal(dial.results.test.output,'first\nsecond\n');
  const stale=dial.openToken;settings.design.speedDial.gap=20;dial.configure(settings);assert.throws(()=>dial.run({id:'test',token:stale}),/changed/);
});

test('failure stops the sequence and reports bounded output', async t => {
  const seen=[];const {dial}=setup(async action=>{seen.push(action.value);throw Object.assign(Error('Failed'),{output:'x'.repeat(9000)})});t.after(()=>dial.stop());dial.run({id:'test'});await finished(dial);
  assert.deepEqual(seen,['first']);assert.equal(dial.results.test.status,'error');assert.equal(dial.results.test.output.length,4096);
});

test('success feedback expires on the display after two seconds while retaining the result', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {dial,settings}=setup(async()=> 'done\n');t.after(()=>dial.stop());
  const store=new FaceStore();store.setSettings(settings,1);dial.on('change',snapshot=>store.setSources({speedDial:snapshot}));
  dial.run({id:'test'});await finished(dial);
  assert.equal(store.frame().dashboard.buttons[0].status,'success');
  t.mock.timers.tick(1999);assert.equal(store.frame().dashboard.buttons[0].status,'success');
  t.mock.timers.tick(1);assert.equal(store.frame().dashboard.buttons[0].status,'idle');
  assert.equal(dial.snapshot().results.test.status,'success');assert.equal(dial.snapshot().results.test.output,'done\ndone\n');
});

test('new runs own their feedback timer and cleanup cancels stale success updates', async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let hold=false,release;
  const {dial,settings}=setup(async()=>{if(hold)await new Promise(resolve=>{release=resolve});return '';});t.after(()=>dial.stop());
  dial.run({id:'test'});await finished(dial);t.mock.timers.tick(1000);
  hold=true;dial.run({id:'test'});t.mock.timers.tick(1000);
  assert.equal(dial.snapshot().dashboard.buttons[0].status,'running');
  hold=false;release();await finished(dial);
  t.mock.timers.tick(1999);assert.equal(dial.snapshot().dashboard.buttons[0].status,'success');
  t.mock.timers.tick(1);assert.equal(dial.snapshot().dashboard.buttons[0].status,'idle');
  dial.run({id:'test'});await finished(dial);
  settings.modules.speedDial.buttons=[];dial.configure(settings);
  let changes=0;dial.on('change',()=>changes++);t.mock.timers.tick(2000);assert.equal(changes,0);
  settings.modules.speedDial.buttons=[button()];dial.configure(settings);dial.run({id:'test'});await finished(dial);
  dial.stop();changes=0;t.mock.timers.tick(2000);assert.equal(changes,0);
});

test('concurrent runs are bounded and shutdown cancels every sequence', async t => {
  const signals=[];
  const {dial,settings}=setup((_action,{signal})=>new Promise((resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(Error('Cancelled')),{once:true});}));t.after(()=>dial.stop());
  settings.modules.speedDial.buttons=Array.from({length:5},(_,i)=>button(`button${i}`));dial.configure(settings);
  for(let i=0;i<4;i++)dial.run({id:`button${i}`});
  assert.throws(()=>dial.run({id:'button4'}),/Four buttons/);assert.equal(dial.running.size,4);
  dial.stop();await finished(dial);assert.ok(signals.every(signal=>signal.aborted));assert.throws(()=>dial.run({id:'button4'}),/stopping/);
});

test('pages wrap, stale page taps are refused and removed buttons cannot run', t => {
  const {dial,settings}=setup(async()=>{});t.after(()=>dial.stop());settings.modules.speedDial.gridSize=4;settings.modules.speedDial.buttons=Array.from({length:9},(_,i)=>button(`button${i}`));dial.configure(settings);
  const token=dial.openToken;dial.page({direction:1});assert.equal(dial.pageIndex,1);assert.equal(dial.pageCount(),3);assert.throws(()=>dial.run({id:'button0',token}),/changed/);
  settings.modules.speedDial.buttons=[button('only')];dial.configure(settings);assert.equal(dial.pageIndex,0);assert.throws(()=>dial.run({id:'button4'}),/available/);
  dial.page({direction:-1});assert.equal(dial.pageIndex,0);
});

test('icons normalize locally and traversal or invalid data is rejected', async t => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'companion-icons-'));t.after(()=>rm(dir,{recursive:true,force:true}));const icons=new SpeedDialIcons(dir);
  const png=await sharp({create:{width:20,height:30,channels:4,background:'#ff000080'}}).png().toBuffer();const image=await icons.save(`data:image/png;base64,${png.toString('base64')}`);
  assert.match(image.assetId,/^[a-f0-9]{64}$/);const bytes=await icons.read(image.assetId);const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,96);assert.equal(metadata.height,96);assert.equal(metadata.hasAlpha,true);
  assert.deepEqual(await icons.save(`data:image/png;base64,${png.toString('base64')}`),image);assert.equal(await icons.read('../settings'),null);await assert.rejects(()=>icons.save('data:image/svg+xml;base64,AAAA'));await assert.rejects(()=>icons.save('data:image/png;base64,AAAA'));
});

test('nine long-label buttons stay within the firmware frame budget with no commands sent', t => {
  const {dial,settings}=setup();t.after(()=>dial.stop());settings.modules.speedDial.gridSize=0;settings.modules.speedDial.buttons=Array.from({length:9},(_,i)=>({...button(String(i).repeat(48)),label:'\u4e00'.repeat(21),color:0xffffff}));dial.configure(settings,'dark',{display:{shape:'rectangular'}});
  const store=new FaceStore();store.setSettings(settings,1);store.setSources({speedDial:dial.snapshot()});const frame=store.frame();const wire=JSON.stringify(frame);
  assert.equal(frame.module,'speedDial');assert.equal(frame.dashboard.buttons.length,9);assert.ok(Buffer.byteLength(wire)<=4096,Buffer.byteLength(wire));assert.ok(!wire.includes('assetId'));assert.ok(!wire.includes('actions'));assert.ok(!wire.includes('first'));
});

test('automatic pages follow display shape and design while invalidating stale taps', t=>{
  const {dial,settings}=setup();t.after(()=>dial.stop());
  settings.modules.speedDial.buttons=Array.from({length:16},(_,i)=>button(`button${i}`));dial.configure(settings);
  assert.equal(dial.visible().length,7);assert.equal(dial.pageCount(),3);
  const token=dial.openToken;dial.configure(settings,'dark',{display:{shape:'rectangular'}});
  assert.equal(dial.visible().length,9);assert.equal(dial.pageCount(),2);assert.equal(dial.snapshot().dashboard.screenShape,'rectangular');
  assert.throws(()=>dial.run({id:'button0',token}),/changed/);
  dial.page({direction:1});assert.equal(dial.visible()[0].id,'button9');
  settings.design.speedDial.buttonSize=48;settings.modules.speedDial.showLabels=false;dial.configure(settings,'dark',{display:{shape:'round'}});
  assert.equal(dial.pageIndex,1);assert.equal(dial.visible().length,3);assert.equal(dial.visible()[0].id,'button13');
  assert.equal(dial.snapshot().dashboard.screenShape,'round');
  dial.page({direction:1});assert.equal(dial.pageIndex,0);assert.equal(dial.visible().length,13);
});

test('all thirteen atlas tiles retain their own pixels and stay inside the existing transfer size',async()=>{
  const colours=Array.from({length:13},(_,i)=>(i+1)*0x080800);
  const buttons=colours.map((color,i)=>({...button(`button${i}`),color}));
  const atlas=await makeSpeedDialAtlas(buttons,{background:0,surface:0},{read:async()=>null});
  assert.equal(atlas.pixels.length,51200);
  for(const [i,color] of colours.entries()) {
    const packed=(((color>>16)>>3)<<11)|((((color>>8)&255)>>2)<<5)|((color&255)>>3);
    for(const x of [0,16,31])for(const y of [0,16,31])assert.equal(atlas.pixels.readUInt16LE(((Math.floor(i/5)*32+y)*160+(i%5)*32+x)*2),packed);
  }
  await assert.rejects(()=>makeSpeedDialAtlas([...buttons,button('overflow')],{background:0,surface:0},{read:async()=>null}),/Too many/);
});

test('list icons blend into the screen and switching layouts keeps their atlas caches separate',async t=>{
  const transparent=await sharp({create:{width:32,height:32,channels:4,background:'#00000000'}}).png().toBuffer();
  const icons={read:async()=>transparent},dial=new SpeedDial({icons});t.after(()=>dial.stop());
  const settings=defaultSettings();settings.modules.speedDial.buttons=[{...button(),color:0xff0000}];
  for(const theme of ['light','dark']) {
    settings.deviceAppearance.mode=theme;
    const palette=settings.deviceAppearance.palettes[theme];
    const packed=(((palette.background>>16)>>3)<<11)|((((palette.background>>8)&255)>>2)<<5)|((palette.background&255)>>3);
    let grid;
    for(const layout of ['grid','list','grid']) {
      settings.modules.speedDial.layout=layout;
      const ready=new Promise(resolve=>dial.once('change',resolve));
      dial.configure(settings);await ready;
      if(!dial.art)await new Promise(resolve=>dial.once('change',resolve));
      assert.ok(dial.art);
      assert.equal(dial.art.pixels.readUInt16LE(0),layout==='list'?packed:0xf800);
      if(layout==='grid'){if(grid)assert.equal(dial.art,grid);grid=dial.art;}
    }
  }
});

test('serial Speed Dial actions require ready, active module and valid IDs and tokens', async t => {
  const {dial,settings}=setup();t.after(()=>dial.stop());const store=new FaceStore();store.setSettings(settings,1);let calls=0;const link=new DeviceLink(store,{onSpeedDialRun:()=>{calls++}});
  const event={type:'speed-dial-run',v:1,id:'test',token:dial.openToken};const send=value=>link.receive(JSON.stringify(value)+'\n');send(event);await turn();assert.equal(calls,0);link.ready=true;send(event);await turn();assert.equal(calls,1);
  send({...event,token:''});send({...event,id:'../x'});store.activeModule='face';send(event);await turn();assert.equal(calls,1);
});

test('action commands keep URL and file arguments separate from shell commands', () => {
  assert.deepEqual(actionCommand({type:'url',value:'https://example.com/a?b=$(whoami)'},'darwin'),['/usr/bin/open',['--','https://example.com/a?b=$(whoami)']]);
  assert.deepEqual(actionCommand({type:'file',value:'~/Documents/test.txt'},'darwin','/Users/test'),['/usr/bin/open',['--','/Users/test/Documents/test.txt']]);
  assert.throws(()=>actionCommand({type:'app',value:'Safari'},'linux'),/macOS/);
});

test('real shell runner returns output and kills timed-out processes', async () => {
  assert.equal(await executeSpeedDialAction({type:'shell',value:"printf 'hello'"}),'hello');
  await assert.rejects(()=>executeSpeedDialAction({type:'shell',value:'sleep 30'},{timeout:40}),/timed out/);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>executeSpeedDialAction({type:'shell',value:'sleep 30'},{signal:controller.signal}),/cancelled/);
});

test('thirteen buttons fit the frame budget and the fourteenth starts the next page',t=>{
  const {dial,settings}=setup();t.after(()=>dial.stop());
  settings.modules.speedDial.gridSize=0;settings.modules.speedDial.showLabels=false;
  settings.modules.speedDial.buttons=Array.from({length:14},(_,i)=>({...button(`button${i}`.padEnd(48,'x')),label:'\u4e00'.repeat(21),color:0xffffff}));
  dial.configure(settings,'dark',{display:{shape:'round'}});
  const store=new FaceStore();store.setSettings(settings,1);store.setSources({speedDial:dial.snapshot()});
  const frame=store.frame();assert.equal(frame.dashboard.buttons.length,13);
  assert.ok(Buffer.byteLength(JSON.stringify(frame))<=4096);
  assert.ok(frame.dashboard.buttons.every(button=>button.label===''));
  assert.ok(dial.snapshot().dashboard.buttons.every(button=>button.label==='\u4e00'.repeat(21)));
  assert.deepEqual(frame.dashboard.buttons.map(button=>button.id),settings.modules.speedDial.buttons.slice(0,13).map(button=>button.id));
  assert.equal(dial.pageCount(),2);dial.page({direction:1});assert.equal(dial.visible().length,1);
  assert.equal(dial.visible()[0].id,settings.modules.speedDial.buttons[13].id);
});
