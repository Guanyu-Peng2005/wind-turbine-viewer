type SoundState='idle'|'starting'|'playing'|'muted'|'blocked'|'unavailable';

/** A user-started three-tone alert. One context and one timer, with explicit cleanup. */
export class AlarmSound{
  private context:AudioContext|null=null;
  private analyser:AnalyserNode|null=null;
  private nodes=new Set<OscillatorNode>();
  private timer:ReturnType<typeof setInterval>|null=null;
  private generation=0;
  private state:SoundState='idle';
  private chimes=0;
  private samples=new Float32Array(256);
  private changed:()=>void;
  constructor(changed:()=>void){this.changed=changed;}

  async start():Promise<void>{
    this.stop();const generation=++this.generation;
    this.state='starting';this.changed();
    try{
      const Context=window.AudioContext??(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Context){this.state='unavailable';this.changed();return;}
      if(!this.context||this.context.state==='closed'){
        this.context=new Context({latencyHint:'interactive'});
        this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;this.analyser.connect(this.context.destination);
      }
      if(this.context.state==='suspended'){
        if(globalThis.navigator?.userActivation&&!navigator.userActivation.isActive){this.state='blocked';this.changed();return;}
        await this.context.resume();
      }
      if(generation!==this.generation)return;
      if(this.context.state!=='running'){this.state='blocked';this.changed();return;}
      this.state='playing';this.chime();
      this.timer=setInterval(()=>this.chime(),2200);this.changed();
    }catch{
      if(generation===this.generation){this.state='blocked';this.changed();}
    }
  }

  private chime():void{
    const context=this.context;if(!context||context.state!=='running'||this.state!=='playing')return;
    this.chimes++;
    for(const [index,frequency]of[660,880,660].entries()){
      const oscillator=context.createOscillator(),envelope=context.createGain(),start=context.currentTime+.02+index*.28;
      oscillator.type='triangle';oscillator.frequency.setValueAtTime(frequency,start);
      envelope.gain.setValueAtTime(0,start);envelope.gain.linearRampToValueAtTime(.16,start+.025);
      envelope.gain.setValueAtTime(.16,start+.16);envelope.gain.linearRampToValueAtTime(0,start+.23);
      oscillator.connect(envelope);envelope.connect(this.analyser!);this.nodes.add(oscillator);
      oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();this.nodes.delete(oscillator);};
      oscillator.start(start);oscillator.stop(start+.25);
    }
  }

  stop(muted=false):void{
    this.generation++;if(this.timer!==null)clearInterval(this.timer);this.timer=null;
    for(const oscillator of this.nodes){try{oscillator.stop();}catch{}oscillator.disconnect();}
    this.nodes.clear();this.state=muted?'muted':'idle';this.changed();
  }
  dispose():void{this.stop();void this.context?.close().catch(()=>{});this.context=null;this.analyser=null;}
  diagnostics(){
    this.analyser?.getFloatTimeDomainData(this.samples);
    return {state:this.state,context:this.context?.state??'not-created',activeNodes:this.nodes.size,timerActive:this.timer!==null,chimes:this.chimes,
      signalPeak:this.analyser?Math.max(...this.samples.map(Math.abs)):0};
  }
}
