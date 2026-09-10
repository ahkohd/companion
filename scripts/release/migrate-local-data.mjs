import { copyFile, mkdir, chmod, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const source=path.resolve('.cache');
const destination=path.join(os.homedir(),'Library/Application Support/Companion');
await mkdir(destination,{recursive:true,mode:0o700});
for(const file of ['studio-settings.json','display-settings.json','device-connection.json','attention-settings.json','roon-pairing.json']){
 try{const target=path.join(destination,file);await copyFile(path.join(source,file),target,constants.COPYFILE_EXCL);await chmod(target,0o600);console.log(`Copied ${file}`)}
 catch(error){if(error.code==='EEXIST')console.log(`Kept existing ${file}`);else if(error.code!=='ENOENT')throw error}
}
// Content-addressed icons can be merged without replacing an existing asset.
const iconDirectory = path.join(source, 'speed-dial-icons');
for (const entry of await readdir(iconDirectory, {withFileTypes:true}).catch(error => { if(error.code==='ENOENT')return [];throw error; })) {
 if (!entry.isFile() || !/^[a-f0-9]{64}\.png$/.test(entry.name)) continue;
 const targetDirectory = path.join(destination, 'speed-dial-icons');
 await mkdir(targetDirectory, {recursive:true,mode:0o700});
 const target = path.join(targetDirectory, entry.name);
 try { await copyFile(path.join(iconDirectory, entry.name), target, constants.COPYFILE_EXCL); await chmod(target, 0o600); }
 catch(error) { if(error.code!=='EEXIST')throw error; }
}
console.log('Settings copied. Originals are unchanged. Environment overrides can be placed in config.env in the same folder.');
