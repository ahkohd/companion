import { copyFile, mkdir, chmod } from 'node:fs/promises';
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
console.log('Settings copied. Originals are unchanged. Environment overrides can be placed in config.env in the same folder.');
