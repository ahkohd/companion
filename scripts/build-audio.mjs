import {mkdir} from 'node:fs/promises';
import path from 'node:path';
export async function buildAudio({root,destination,run,arch=process.arch}) {
  await mkdir(destination,{recursive:true});
  const output=path.join(destination,'companion-audio');
  await run('/usr/bin/xcrun',['swiftc','-O','-target',`${arch==='x64'?'x86_64':arch}-apple-macosx13.0`,'-framework','CoreAudio',path.join(root,'native/audio/main.swift'),'-o',output]);
  await run('/usr/bin/codesign',['--force','--sign','-',output]);
}
