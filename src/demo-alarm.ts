export type DemoAlarmTarget={id:string;name:string;partLabel:string;alarm:number;precision:number;unit:string};
export type DemoAlarmSignal={target:DemoAlarmTarget;value:number;raisedAt:number;sequence:number};

/** Only this explicit signal can override the normal demonstration stream. */
export class DemoAlarmState{
  active:DemoAlarmSignal|null=null;
  muted=false;
  private sequence=0;
  raise(target:DemoAlarmTarget,now=Date.now()):DemoAlarmSignal{
    if(!Number.isFinite(target.alarm)||target.alarm<=0)throw new Error('无效的演示告警阈值');
    this.muted=false;
    const snapshot={id:target.id,name:target.name,partLabel:target.partLabel,alarm:target.alarm,precision:target.precision,unit:target.unit};
    this.active={target:snapshot,value:Number((target.alarm*1.35).toFixed(target.precision)),raisedAt:now,sequence:++this.sequence};
    return this.active;
  }
  valueFor(sensorId:string,normalValue:number|null):number|null{
    return this.active?.target.id===sensorId?this.active.value:normalValue;
  }
  clear():void{this.active=null;this.muted=false;}
}
