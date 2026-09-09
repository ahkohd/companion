import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {runModuleCommand} from './module-sources.mjs';
const helper=fileURLToPath(new URL('../.tools/companion-audio',import.meta.url));
const blank=()=>({status:'disabled',error:null,scope:'output',deviceId:0,deviceName:'',nextDeviceId:0,deviceCount:0,volume:null,muted:null,canVolume:false,canMute:false,inputs:[],outputs:[],pickerOpen:false,pageIndex:0,pageCount:2,devices:[]});
const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,128):'';
const validID=value=>Number.isInteger(value)&&value>0&&value<=0xffffffff;
export class AudioSource extends EventEmitter {
  constructor({runner=runModuleCommand,platform=process.platform,helperPath=helper,intervalMs=1500}={}) {
    super();Object.assign(this,{runner,platform,helperPath,intervalMs});this.value=blank();this.scope='output';this.started=false;this.enabled=false;this.generation=0;this.pending=false;this.pickerOpen=false;this.pickerPage=0;
  }
  snapshot(){return structuredClone(this.value)}
  publish(patch){this.value={...this.value,...patch};this.emit('change',this.snapshot())}
  configure({enabled,active=true}={}){if(!active&&this.pickerOpen){this.pickerOpen=false;this.pickerPage=0;if(this.data)this.apply(this.data)}if(this.enabled===!!enabled)return;this.enabled=!!enabled;this.reset();if(this.started&&this.enabled)void this.poll()}
  reset(){this.generation++;clearTimeout(this.timer);this.controller?.abort();this.controller=null;this.pending=false;this.data=null;this.pickerOpen=false;this.pickerPage=0;this.publish({...blank(),scope:this.scope})}
  start(){if(this.started)return;this.started=true;if(this.enabled)void this.poll()}
  stop(){this.started=false;this.reset()}
  async command(args,signal){
    if(this.platform!=='darwin')throw Error('Audio controls require macOS.');
    const result=await this.runner(this.helperPath,args,{signal,timeoutMs:4000,maxOutputBytes:65536});
    if(result.code!==0)throw Error(clean(result.stderr)||'Could not read Mac audio devices.');
    const data=JSON.parse(result.stdout);
    for(const scope of ['input','output'])if(!data?.[scope]||!Array.isArray(data[scope].devices)||data[scope].devices.length>128)throw Error('Invalid audio device response.');
    return data;
  }
  apply(data){
    this.data=data;const current=data[this.scope];
    const list=scope=>data[scope].devices.filter(d=>validID(d.id)).map(d=>({id:d.id,name:clean(d.name)}));
    const devices=list(this.scope),index=devices.findIndex(d=>d.id===current.deviceId),available=index>=0;
    const pickerDevices=available?[devices[index],...devices.filter(d=>d.id!==current.deviceId)]:devices;
    if(!devices.length)this.pickerOpen=false;
    const pageCount=this.pickerOpen?Math.ceil(devices.length/3):2;
    this.pickerPage=Math.max(0,Math.min(this.pickerPage,pageCount-1));
    this.publish({pickerOpen:this.pickerOpen,pageIndex:this.pickerOpen?this.pickerPage:(this.scope==='input'?1:0),pageCount,
      devices:this.pickerOpen?pickerDevices.slice(this.pickerPage*3,this.pickerPage*3+3).map(d=>({...d,active:d.id===current.deviceId})):[],
      status:available?'ready':'unavailable',error:available?null:`No ${this.scope} device is available.`,scope:this.scope,deviceId:available?current.deviceId:0,deviceName:clean(current.deviceName),deviceCount:devices.length,nextDeviceId:devices.length>1?devices[(index+1)%devices.length].id:0,
      volume:Number.isFinite(current.volume)?Math.round(Math.max(0,Math.min(100,current.volume))):null,muted:typeof current.muted==='boolean'?current.muted:null,
      canVolume:available&&current.canVolume===true,canMute:available&&current.canMute===true,inputs:list('input'),outputs:list('output')});
  }
  schedule(){clearTimeout(this.timer);if(this.started&&this.enabled){this.timer=setTimeout(()=>void this.poll(),this.intervalMs);this.timer.unref?.()}}
  async poll(){
    if(!this.started||!this.enabled||this.pending)return;
    const generation=this.generation,controller=new AbortController();this.controller=controller;
    try{const data=await this.command(['get'],controller.signal);if(generation===this.generation)this.apply(data)}
    catch(error){if(generation===this.generation){this.data=null;this.pickerOpen=false;this.pickerPage=0;this.publish({...blank(),scope:this.scope,status:'error',error:clean(error.message)})}}
    finally{if(this.controller===controller)this.controller=null;if(generation===this.generation)this.schedule()}
  }
  view({open,scope,deviceId}={}){
    if(!this.started||!this.enabled)throw Error('Enable Audio first.');
    if(typeof open!=='boolean'||scope!==this.scope||deviceId!==this.value.deviceId||!validID(deviceId))throw Error('The active audio device changed. Try again.');
    if(open&&!this.data?.[scope]?.devices.length)throw Error('No audio devices are available.');
    this.pickerOpen=open;
    this.pickerPage=0;
    this.apply(this.data);return this.snapshot();
  }
  page({scope,direction}={}){
    if(!this.enabled)throw Error('Enable Audio first.');
    if(direction!==undefined){if(![-1,1].includes(direction))throw Error('Choose a valid audio direction.');if(this.pickerOpen){this.pickerPage=(this.pickerPage+direction+this.value.pageCount)%this.value.pageCount;this.apply(this.data);return this.snapshot()}scope=this.scope==='input'?'output':'input'}
    if(!['input','output'].includes(scope))throw Error('Choose Input or Output.');
    this.pickerOpen=false;this.pickerPage=0;this.scope=scope;if(this.data)this.apply(this.data);else this.publish({scope});return this.snapshot();
  }
  async control({scope,deviceId,action,value}={}){
    if(!this.started||!this.enabled)throw Error('Enable Audio first.');
    if(scope!==this.scope||!['input','output'].includes(scope)||!validID(deviceId))throw Error('Choose an audio device.');
    if(this.pending)throw Error('An audio change is already pending.');
    if(!['volume','mute','device'].includes(action))throw Error('Choose a valid audio control.');
    if(action==='volume'&&(!Number.isInteger(value)||value<0||value>100)||action==='mute'&&typeof value!=='boolean'||action==='device'&&!validID(value))throw Error('Choose a valid audio value.');
    const generation=++this.generation,controller=new AbortController();this.controller?.abort();this.controller=controller;clearTimeout(this.timer);this.pending=true;
    try{
      const data=await this.command(['get'],controller.signal);
      if(generation!==this.generation)throw Error('Audio settings changed.');
      this.apply(data);
      if(data[scope].deviceId!==deviceId)throw Error('The active audio device changed. Try again.');
      if(action==='device'&&!data[scope].devices.some(d=>d.id===value))throw Error('That audio device disconnected.');
      if(action==='volume'&&!data[scope].canVolume||action==='mute'&&!data[scope].canMute)throw Error('This control is managed by the audio device.');
      const result=action==='device'&&value===deviceId?data:await this.command([action,scope,String(action==='device'?value:deviceId),String(action==='device'?deviceId:value)],controller.signal);
      if(generation===this.generation){if(action==='device')this.pickerOpen=false;this.apply(result);}
      return this.snapshot();
    }finally{if(generation===this.generation)this.pending=false;if(this.controller===controller)this.controller=null;if(generation===this.generation)this.schedule()}
  }
}
