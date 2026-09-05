import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=data=>createHash('sha256').update(data).digest('hex');
let valid=false;
try {
  const manifest=JSON.parse(await readFile('shared/grok-manifest.json','utf8'));
  const inputs=await Promise.all(manifest.inputs.map(p=>readFile(p)));
  const clips=await Promise.all(manifest.clips.map(c=>readFile(`public/grok/${c.id.slice(5)}.bin`)));
  const packed=await readFile('firmware/main/grok_clips.bin');
  valid=sha(Buffer.concat(inputs))===manifest.sourceHash&&sha(packed)===manifest.sha256&&clips.every((b,i)=>sha(b)===manifest.clips[i].sha256);
} catch { /* A clean checkout has source and manifests but no generated binary clips. */ }
if(!valid)execFileSync(process.execPath,['scripts/build-grok-clips.mjs'],{stdio:'inherit'});
