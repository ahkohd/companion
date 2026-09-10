import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('native face scaling preserves default pixels, clips bounds and grows the eyes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'face-scale-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const probe=path.join(directory,'probe');
 execFileSync('cc',['-std=c11','-O2','-Wall','-Wextra','-Werror','-I','firmware/main','test/face-scale-probe.c','firmware/main/face_model.c','-lm','-o',probe]);
 execFileSync(probe);
});
