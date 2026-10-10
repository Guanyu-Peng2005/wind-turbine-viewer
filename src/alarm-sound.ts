type SoundState='idle'|'starting'|'playing'|'muted'|'blocked'|'unavailable'|'failed';

/** 用户触发的素材播放；下载与解码复用，始终只保留一个循环音源。 */
export class AlarmSound{
  private context:AudioContext|null=null;
  private analyser:AnalyserNode|null=null;
  private source:AudioBufferSourceNode|null=null;
  private gain:GainNode|null=null;
  private bytes:Promise<ArrayBuffer>|null=null;
  private decoding:Promise<AudioBuffer>|null=null;
  private buffer:AudioBuffer|null=null;
  private generation=0;
  private state:SoundState='idle';
  private playbacks=0;
  private samples=new Float32Array(256);
  private changed:()=>void;
  private assetUrl:string;
  constructor(changed:()=>void,assetUrl:string){this.changed=changed;this.assetUrl=assetUrl;}

  private fetchAsset():Promise<ArrayBuffer>{
    if(!this.bytes){
      this.bytes=fetch(this.assetUrl).then(response=>{
        if(!response.ok)throw new Error('告警音效下载失败');
        return response.arrayBuffer();
      }).catch(error=>{this.bytes=null;throw error;});
    }
    return this.bytes;
  }

  /** 预下载不创建音频上下文，页面初次打开保持安静。 */
  preload():void{void this.fetchAsset().catch(()=>{});}

  private loadBuffer(context:AudioContext):Promise<AudioBuffer>{
    if(this.buffer)return Promise.resolve(this.buffer);
    if(!this.decoding){
      const pending=this.fetchAsset().then(bytes=>context.decodeAudioData(bytes.slice(0))).then(buffer=>{
        if(this.context===context)this.buffer=buffer;
        return buffer;
      }).catch(error=>{this.bytes=null;throw error;}).finally(()=>{
        if(this.decoding===pending)this.decoding=null;
      });
      this.decoding=pending;
    }
    return this.decoding;
  }

  async start():Promise<void>{
    this.stop();const generation=++this.generation;
    this.state='starting';this.changed();
    let loading=false;
    try{
      const Context=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Context){this.state='unavailable';this.changed();return;}
      if(!this.context||this.context.state==='closed'){
        this.context=new Context({latencyHint:'interactive'});
        this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.analyser.connect(this.context.destination);
      }
      const context=this.context;
      // 必须在点击手势中先解锁声音，再等待网络或解码，兼容手机浏览器。
      if(context.state!=='running'){
        if(globalThis.navigator?.userActivation&&!navigator.userActivation.isActive){this.state='blocked';this.changed();return;}
        await context.resume();
      }
      if(generation!==this.generation)return;
      if(context.state!=='running'){this.state='blocked';this.changed();return;}
      loading=true;const buffer=await this.loadBuffer(context);loading=false;
      if(generation!==this.generation)return;
      if(context.state!=='running'){this.state='blocked';this.changed();return;}
      const source=context.createBufferSource(),gain=context.createGain();
      this.source=source;this.gain=gain;
      source.buffer=buffer;source.loop=true;
      gain.gain.setValueAtTime(0,context.currentTime);
      gain.gain.linearRampToValueAtTime(.28,context.currentTime+.015);
      source.connect(gain);gain.connect(this.analyser!);
      source.start();this.playbacks++;this.state='playing';this.changed();
    }catch{
      if(generation===this.generation){
        this.stop();this.state=loading?'failed':'blocked';this.changed();
      }
    }
  }

  stop(muted=false):void{
    this.generation++;
    if(this.source){try{this.source.stop();}catch{}this.source.disconnect();this.source=null;}
    this.gain?.disconnect();this.gain=null;
    this.state=muted?'muted':'idle';this.changed();
  }
  dispose():void{
    this.stop();void this.context?.close().catch(()=>{});
    this.context=null;this.analyser=null;this.buffer=null;this.bytes=null;this.decoding=null;
  }
  diagnostics(){
    this.analyser?.getFloatTimeDomainData(this.samples);
    return {state:this.state,context:this.context?.state??'not-created',activeNodes:this.source?1:0,timerActive:false,playbacks:this.playbacks,
      assetUrl:this.assetUrl,assetLoaded:!!this.buffer,duration:this.buffer?.duration??0,
      signalPeak:this.analyser&&this.state==='playing'?Math.max(...this.samples.map(Math.abs)):0};
  }
}
