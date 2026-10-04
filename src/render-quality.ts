/** Pixel workload follows measured frame cadence. Geometry and mechanism fidelity
 * are unchanged, and pausing always restores the full-resolution image. */
export class RenderQuality {
  private motionIndex=0;
  private navigationIndex=1;
  private motionTiers=[1,.9,.8,.7];
  private navigationTiers=[.8,.7,.6,.5];
  private samples:number[]=[];
  private elapsed=0;
  private mode='';
  private lastChange=0;
  private changes=0;
  get motionScale(){return this.motionTiers[this.motionIndex];}
  get navigationScale(){return this.navigationTiers[this.navigationIndex];}
  reset(){this.samples.length=0;this.elapsed=0;this.mode='';}
  observe(frameMs:number,navigating:boolean,moving:boolean,now:number):boolean{
    const mode=navigating?'navigation':moving?'motion':'idle';
    if(mode!==this.mode){this.reset();this.mode=mode;}
    if(mode==='idle'||frameMs<4||frameMs>150)return false;
    this.samples.push(frameMs);this.elapsed+=frameMs;
    if(this.elapsed<600||this.samples.length<12||now-this.lastChange<1000)return false;
    const average=this.samples.reduce((a,b)=>a+b,0)/this.samples.length;
    const slow=this.samples.filter(t=>t>25).length;
    const tiers=navigating?this.navigationTiers:this.motionTiers;
    let index=navigating?this.navigationIndex:this.motionIndex,next=index;
    if(average>22&&slow>=3)next=Math.min(index+1,tiers.length-1);
    else if(average<17.5&&this.elapsed>=2200)next=Math.max(index-1,0);
    if(next===index){if(this.elapsed>2400){this.samples.length=0;this.elapsed=0;}return false;}
    if(navigating)this.navigationIndex=next;else this.motionIndex=next;
    this.lastChange=now;this.changes++;this.samples.length=0;this.elapsed=0;return true;
  }
  diagnostics(){return {motionScale:this.motionScale,navigationScale:this.navigationScale,adjustments:this.changes};}
}
