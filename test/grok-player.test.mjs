import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {build} from 'vite';
import catalog from '../shared/grok-catalog.json' with {type:'json'};
import {FaceStore} from '../bridge/store.mjs';
const sha=data=>createHash('sha256').update(data).digest('hex');
const hash565=pixels=>{let hash=2166136261;for(const pixel of pixels)hash=Math.imul(hash^pixel,16777619)>>>0;return hash};
let model,probe,temp;
before(async()=>{
  temp=await mkdtemp(path.join(os.tmpdir(),'grok-player-'));probe=path.join(temp,'probe');
  execFileSync('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-I','firmware/main','test/grok-player-probe.c','firmware/main/grok_player.c','firmware/main/grok_codec.c','-lm','-o',probe]);
  const result=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:'web/grok-player.ts',formats:['es']}}});
  const bundle=Array.isArray(result)?result[0]:result;
  model=await import('data:text/javascript;base64,'+Buffer.from(bundle.output.find(c=>c.type==='chunk'&&c.isEntry).code).toString('base64'));
});
after(async()=>{if(temp)await rm(temp,{recursive:true,force:true})});
test('all 39 source states and eight actions are packed identically for both screens',async()=>{
  const manifest=JSON.parse(await readFile('shared/grok-manifest.json','utf8'));
  assert.equal(catalog.filter(c=>c.group!=='Actions').length,39);assert.equal(catalog.length,47);
  assert.equal(new Set(catalog.map(c=>c.id)).size,47);
  const inputs=await Promise.all(manifest.inputs.map(p=>readFile(p)));
  assert.equal(sha(Buffer.concat(inputs)),manifest.sourceHash,'Regenerate the Grok clips after changing source inputs');
  const buffers=await Promise.all(catalog.map(c=>readFile(`public/grok/${c.source}.bin`)));
  const packed=Buffer.concat(buffers);
  assert.equal(sha(packed),manifest.sha256);assert.equal(packed.length,manifest.bytes);
  assert.deepEqual(await readFile('firmware/main/grok_clips.bin'),packed);
  for(let i=0;i<catalog.length;i++) {assert.equal(manifest.clips[i].id,catalog[i].id);assert.equal(sha(buffers[i]),manifest.clips[i].sha256)}
});
test('bridge selects and replays every clip without changing agent status semantics',()=>{
  const store=new FaceStore();
  for(const clip of catalog) {
    store.setExpression(clip.id);
    assert.equal(store.snapshot().display.animation,clip.id);assert.equal(store.frame().animation,clip.id);
    assert.equal(store.frame().state,'idle');assert.equal(store.frame().preview,true);
    store.changedAt=123;store.setExpression(clip.id);assert.notEqual(store.changedAt,123);
    const changed=store.changedAt;store.publish();assert.equal(store.changedAt,changed);
  }
  assert.throws(()=>store.setExpression('grok:missing'),/Unknown expression/);
  store.setExpression(null);assert.equal(store.frame().animation,null);
  store.setExpression('done');assert.equal(store.frame().state,'done');assert.equal(store.frame().animation,null);
});
test('native and browser playback match after seeks, loop seams, long uptime, reduced motion and replays',async()=>{
  const commands=[],expected=[];
  for(const clip of catalog) {
    const file=`public/grok/${clip.source}.bin`,bytes=await readFile(file),player=new model.GrokPlayer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    for(const [age,still] of [[0,0],[.13,0],[.54,0],[1.1,0],[2.7,0],[5.6,0],[7.99,0],[11.97,0],[12,0],[12.1,0],[27,0],[86400.2,0],[0,0],[0,1],[3,0]]) {
      player.sample(age,Boolean(still));commands.push(`${file} ${age} ${still}`);expected.push({index:player.index,hash:hash565(player.pixels)});
    }
  }
  const actual=execFileSync(probe,[],{input:commands.join('\n')+'\n',encoding:'utf8',maxBuffer:1024*1024}).trim().split('\n').map(JSON.parse);
  assert.deepEqual(actual,expected);
});
test('native Grok rendering matches browser pixels and stays above the status text',async()=>{
  for(const name of ['happy','radar','celebrate','writing','spin-wild']) {
    const file=`public/grok/${name}.bin`,bytes=await readFile(file),player=new model.GrokPlayer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    player.sample(2.7);const expected=new Uint16Array(466*466);model.grokRaster(player.pixels,expected,466,466,.4,-.2);
    const ppm=execFileSync(probe,['--ppm',file,'2.7','.4','-.2'],{maxBuffer:1024*1024}),actual=ppm.subarray(Buffer.byteLength('P6\n466 466\n255\n'));
    let lit=0;
    for(let i=0;i<expected.length;i++) {
      const p=expected[i],r=p>>11,g=(p>>5)&63,b=p&31,rgb=[(r<<3)|(r>>2),(g<<2)|(g>>4),(b<<3)|(b>>2)];
      if(p)lit++;
      rgb.forEach((v,j)=>assert.equal(actual[i*3+j],v,`${name} pixel ${i} channel ${j}`));
      if(i>=330*466)assert.equal(p,0);
    }
    assert.ok(lit>100,`${name} is blank`);
  }
});
test('clip headers and offset tables reject malformed data',()=>{
  for(const size of [0,4,23,24,40])assert.throws(()=>new model.GrokPlayer(new ArrayBuffer(size)));
});

test('scaled Grok frames match native pixels and refresh at unchanged playback age',async()=>{
  const file='public/grok/radar.bin',bytes=await readFile(file),player=new model.GrokPlayer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  player.sample(2.7,true);const index=player.index;
  const baseline=new Uint16Array(466*466);model.grokRaster(player.pixels,baseline,466,466,.4,-.2);
  const areas=[];
  for(const scale of [50,100,150,50,100]){
    assert.equal(player.sample(2.7,true),false);assert.equal(player.index,index);
    const image=new Uint16Array(466*466);model.grokRaster(player.pixels,image,466,466,.4,-.2,scale);
    if(scale===100)assert.deepEqual(image,baseline);
    areas.push(image.reduce((n,p)=>n+(p!==0),0));
  }
  assert.ok(areas[0]<areas[1]&&areas[1]<areas[2]);assert.equal(areas[0],areas[3]);
  player.sample(2.7,false);
  for(const scale of [50,75,100,125,150]){
    const image=new Uint16Array(466*466);model.grokRaster(player.pixels,image,466,466,.4,-.2,scale);
    const ppm=execFileSync(probe,['--ppm',file,'2.7','.4','-.2',String(scale)],{maxBuffer:1024*1024}),actual=ppm.subarray(Buffer.byteLength('P6\n466 466\n255\n'));
    for(let i=0;i<image.length;i++){
      const p=image[i],r=p>>11,g=(p>>5)&63,b=p&31;
      assert.equal(actual[i*3],(r<<3)|(r>>2));assert.equal(actual[i*3+1],(g<<2)|(g>>4));assert.equal(actual[i*3+2],(b<<3)|(b>>2));
      const x=i%466+.5-233,y=Math.floor(i/466)+.5-233;
      if(x*x+y*y>233*233)assert.equal(p,0);
    }
  }
});
