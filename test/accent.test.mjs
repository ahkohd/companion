import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {build} from 'vite';
let model,probe,directory;
before(async()=>{
  directory=await mkdtemp(path.join(os.tmpdir(),'face-accent-'));probe=path.join(directory,'probe');
  execFileSync('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-I','firmware/main','test/accent-probe.c','firmware/main/face_accent.c','firmware/main/face_decor.c','firmware/main/face_model.c','-lm','-o',probe]);
  const result=await build({configFile:false,logLevel:'silent',build:{write:false,minify:false,lib:{entry:'web/face-model.ts',formats:['es']}}});
  const bundle=Array.isArray(result)?result[0]:result;
  model=await import('data:text/javascript;base64,'+Buffer.from(bundle.output.find(c=>c.type==='chunk'&&c.isEntry).code).toString('base64'));
});
after(async()=>{if(directory)await rm(directory,{recursive:true,force:true})});
const near=(a,b,tolerance=.011)=>assert.ok(Math.abs(a-b)<tolerance,`${a} vs ${b}`);
test('native accents match the extracted motion and all particle vertices over the full sequence',()=>{
  const expected=[],commands=[];
  for(const [i,state] of model.FACE_STATES.entries()) for(const t of [...Array.from({length:181},(_,i)=>i/60),9.3,900.1,86400]) {
    commands.push(`${i} ${t}`);expected.push(model.grokAccent(state,t));
  }
  const actual=execFileSync(probe,[],{input:commands.join('\n')+'\n',encoding:'utf8',maxBuffer:10*1024*1024}).trim().split('\n').map(JSON.parse);
  assert.equal(actual.length,expected.length);
  actual.forEach((a,i)=>{
    const b=expected[i];for(const k of ['x','y','rotation','scale'])near(a[k],b[k],.001);
    assert.equal(a.decor.length,b.decor.length);
    a.decor.forEach((p,j)=>{const q=b.decor[j];assert.equal(p.color,q.color);near(p.alpha,q.alpha,.0001);assert.equal(p.points.length,q.points.length);p.points.forEach((point,k)=>point.forEach((v,l)=>near(v,q.points[k][l])))});
    const eyes=[{matrix:[1,.2,-.1,.8,-20,10]},{matrix:[.6,-.1,.2,.9,30,5]}];
    model.accentEyes(eyes,b).forEach((e,j)=>e.matrix.forEach((v,k)=>near(a.matrices[j][k],v,.001)));
  });
});
test('completion runs once, working keeps its gentle pose without dots, and reduced motion disables accents',()=>{
  assert.ok(model.grokAccent('done',.5).rotation>0);
  assert.ok(model.grokAccent('done',1.1).decor.length>10);
  for(const t of [2.2,9,10000])assert.deepEqual(model.grokAccent('done',t),{x:0,y:0,rotation:0,scale:1,decor:[]});
  for(const t of [1,20,901]) {
    const accent=model.grokAccent('working',t);
    assert.equal(accent.decor.length,0);
    assert.notEqual(accent.rotation,0);
  }
  for(const state of model.FACE_STATES)assert.deepEqual(model.grokAccent(state,1.1,true),{x:0,y:0,rotation:0,scale:1,decor:[]});
  const scene=new model.FaceMotion('done',20).scene(20,20);
  assert.equal(scene.decor.length,0,'Joining an old ready state must not replay confetti');
});
test('native celebration has coloured pixels and decorations stay clear of the text area',()=>{
  const image=execFileSync(probe,['2','1.1']),header=Buffer.from('P6\n466 466\n255\n');
  assert.ok(image.subarray(0,header.length).equals(header));const pixels=image.subarray(header.length);
  let colourful=0;
  for(let i=0;i<466*466;i++) {
    const [r,g,b]=pixels.subarray(i*3,i*3+3);
    if(r>g*1.4||b>g*1.4)colourful++;
    if(Math.floor(i/466)>=330)assert.equal(r+g+b,0,'Animation must stay above the labels');
  }
  assert.ok(colourful>80,`Only ${colourful} coloured pixels`);
});

test('decoration raster preserves star gaps, alpha blending and clip bounds',()=>{
  const target=path.join(directory,'decor-probe');
  execFileSync('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','test/decor-raster-probe.c','firmware/main/face_decor.c','-lm','-o',target]);
  assert.match(execFileSync(target,[],{encoding:'utf8'}),/all decor raster checks passed/);
});

test('working decoration layer is empty across the full screen',()=>{
  const header=Buffer.from('P6\n466 466\n255\n');
  for(const age of [.45,.8,1.1,1.5,2,900.1]) {
    const pixels=execFileSync(probe,['0',String(age),'decor-only']).subarray(header.length);
    for(let y=0;y<466;y++) for(let x=0;x<466;x++) {
      const offset=(y*466+x)*3;
      assert.equal(pixels[offset]+pixels[offset+1]+pixels[offset+2],0,`Unexpected working decoration at ${x},${y}`);
    }
  }
});
