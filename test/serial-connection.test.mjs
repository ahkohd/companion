import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { SerialConnection } from '../bridge/serial-connection.mjs';
import { DeviceLink } from '../bridge/device.mjs';
const board = (path, serialNumber='ABC') => ({path, serialNumber, vendorId:'303a', productId:'1001'});
async function fixture(t, port='') {
 const directory=await mkdtemp(path.join(os.tmpdir(),'serial-manager-')); t.after(()=>rm(directory,{recursive:true,force:true}));
 const store={device:{},setDevice(update){Object.assign(this.device,update)}};
 const calls=[]; const link={stopped:true,path:'',async stop(){calls.push(['stop',this.path]);this.stopped=true},start(){assert(this.stopped);calls.push(['start',this.path]);this.stopped=false}};
 let rows=[],failure=null;const manager=new SerialConnection(store,{link,port,filePath:path.join(directory,'connection.json'),listPorts:async()=>{if(failure)throw failure;return rows}});
 t.after(()=>manager.stop());
 return {manager,link,calls,store,setRows(value){rows=value},fail(value){failure=value}};
}
test('off stays browser-only; manual persists serial and follows its moved path',async t=>{
 const f=await fixture(t);f.setRows([board('/dev/tty.usbmodem1')]);await f.manager.start();assert.equal(f.link.stopped,true);
 await f.manager.configure({mode:'manual',path:'/dev/cu.usbmodem1'});assert.equal(f.link.path,'/dev/cu.usbmodem1');
 f.setRows([board('/dev/cu.usbmodem9'),board('/dev/cu.usbmodem2','OTHER')]);await f.manager.refresh();assert.equal(f.link.path,'/dev/cu.usbmodem9');
 assert.equal(JSON.parse(await readFile(f.manager.filePath)).serialNumber,'ABC');
 f.setRows([board('/dev/cu.usbmodem2','OTHER')]);await f.manager.refresh();assert.equal(f.link.stopped,true);
 await f.manager.configure({mode:'off'});await f.manager.refresh();assert.equal(f.store.device.status,'disabled');
 await f.manager.stop();await f.manager.start();assert.equal(f.manager.snapshot().mode,'off');
});
test('auto discovers only a unique compatible board and remembers it',async t=>{
 const f=await fixture(t);await f.manager.start();f.setRows([board('/a','A'),board('/b','B')]);await f.manager.configure({mode:'auto'});
 assert.equal(f.link.stopped,true);assert.match(f.manager.snapshot().error,/Multiple/);
 f.setRows([board('/a','A'),{path:'/unrelated',vendorId:'0000',productId:'0000'}]);await f.manager.refresh();assert.equal(f.link.path,'/a');
 f.setRows([board('/b','B')]);await f.manager.refresh();assert.equal(f.link.stopped,true);
 await assert.rejects(f.manager.configure({mode:'manual',path:'/not-enumerated'}),/available/);
});
test('stale environment seed finds a unique board and refresh failures keep existing link',async t=>{
 const f=await fixture(t,'/dev/tty.seed');f.setRows([board('/other')]);await f.manager.start();assert.equal(f.link.path,'/other');
 f.setRows([board('/dev/cu.seed')]);await f.manager.refresh();assert.equal(f.link.path,'/dev/cu.seed');
 f.fail(Error('scan failed'));await f.manager.refresh();assert.equal(f.link.stopped,false);assert.match(f.manager.snapshot().error,/scan failed/);
 f.fail(null);await f.manager.reconnect();assert.equal(f.link.stopped,false);
});
test('concurrent selections wait for closing before opening the next port',async t=>{
 const f=await fixture(t);f.setRows([board('/a','A'),board('/b','B')]);await f.manager.start();
 let release;const original=f.link.stop;f.link.stop=async function(){if(!this.stopped)await new Promise(resolve=>{release=resolve});return original.call(this)};
 await f.manager.configure({mode:'manual',path:'/a'});
 const next=f.manager.configure({mode:'manual',path:'/b'});const off=f.manager.configure({mode:'off'});
 while(!release)await new Promise(resolve=>setImmediate(resolve));assert.equal(f.link.path,'/a');
 release();f.link.stop=original;await next;await off;assert.equal(f.link.stopped,true);assert.equal(f.manager.snapshot().mode,'off');
});
test('DeviceLink stop awaits a pending open and ignores stale callbacks',async()=>{
 class Port extends EventEmitter {constructor(){super();Port.instances.push(this)}open(cb){this.openCallback=cb}close(cb){this.isOpen=false;this.emit('close');cb?.()}write(_data,cb){cb?.()}} Port.instances=[];
 const store=new EventEmitter();store.device={};store.setDevice=update=>Object.assign(store.device,update);
 const link=new DeviceLink(store,{port:'/a',Port});link.start();const first=Port.instances[0];const stopped=link.stop();let done=false;stopped.then(()=>done=true);await Promise.resolve();assert.equal(done,false);
 first.isOpen=true;first.openCallback();await stopped;assert.equal(first.isOpen,false);
 link.path='/b';link.start();const second=Port.instances[1];second.isOpen=true;second.openCallback();assert.equal(store.device.status,'waiting');
 first.emit('error',Error('stale'));first.emit('close');first.emit('data',Buffer.from('{"type":"ready","v":1,"board":"waveshare-1.75-b"}\n'));assert.equal(store.device.status,'waiting');assert.equal(link.ready,false);
 await link.stop();
});

test('remembered manual USB identity rejects an unrelated device with the same serial',async t=>{
 const f=await fixture(t);f.setRows([board('/board')]);await f.manager.start();await f.manager.configure({mode:'manual',path:'/board'});
 await f.manager.stop();f.setRows([{...board('/other'),vendorId:'1234',productId:'5678'}]);await f.manager.start();
 assert.equal(f.link.stopped,true);assert.equal(f.manager.snapshot().path,'/board');
 f.setRows([board('/moved')]);await f.manager.refresh();assert.equal(f.link.path,'/moved');
});

test('manual selection disambiguates multiple ports with the same identity',async t=>{
 const f=await fixture(t);f.setRows([board('/a'),board('/b')]);await f.manager.start();
 await f.manager.configure({mode:'manual',path:'/b'});assert.equal(f.link.path,'/b');
});
