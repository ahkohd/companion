import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const arch=process.arch;
if(process.platform!=='darwin'||!['arm64','x64'].includes(arch))throw Error('Run on macOS arm64 or x64.');
const root=path.resolve('.tools/release-deps');await mkdir(root,{recursive:true});
const downloads=[
 {name:'Sparkle-2.9.6.tar.xz',url:'https://github.com/sparkle-project/Sparkle/releases/download/2.9.6/Sparkle-2.9.6.tar.xz',sha:'52bf9e88cdd972fc0c81501377a880e90d47031bd8ca5462488f843e2609e192',dir:'sparkle'},
 {name:`node-v24.12.0-darwin-${arch}.tar.gz`,url:`https://nodejs.org/dist/v24.12.0/node-v24.12.0-darwin-${arch}.tar.gz`,sha:arch==='arm64'?'319f221adc5e44ff0ed57e8a441b2284f02b8dc6fc87b8eb92a6a93643fd8080':'b82ea4c62fd08e250cab59d625e75d77cc5b0a3d60c6698ebee4545c88a169c5',dir:'node'}
];
for(const d of downloads){
 const res=await fetch(d.url);if(!res.ok)throw Error(`Download failed: ${d.name} (${res.status})`);
 const data=Buffer.from(await res.arrayBuffer());if(createHash('sha256').update(data).digest('hex')!==d.sha)throw Error(`Checksum mismatch: ${d.name}`);
 const archive=path.join(root,d.name),dest=path.join(root,d.dir);await writeFile(archive,data);await mkdir(dest,{recursive:true});
 execFileSync('/usr/bin/tar',['-xf',archive,'-C',dest]);
}
console.log(`COMPANION_NODE_BINARY=${root}/node/node-v24.12.0-darwin-${arch}/bin/node`);
console.log(`SPARKLE_FRAMEWORK=${root}/sparkle/Sparkle.framework`);
console.log(`SPARKLE_TOOLS=${root}/sparkle/bin`);
