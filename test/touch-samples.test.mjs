import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('buffered physical touch preserves swipes and fails closed on lost samples',()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'touch-samples-'));
  try {
    const probe=path.join(directory,'probe');
    execFileSync('cc',['-std=c11','-Wall','-Wextra','-Werror','-I','firmware/boards','-I','firmware/main','test/touch-samples-probe.c','firmware/boards/touch_samples.c','firmware/main/module_touch.c','-o',probe]);
    assert.match(execFileSync(probe,[],{encoding:'utf8'}),/touch sample checks passed/);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
