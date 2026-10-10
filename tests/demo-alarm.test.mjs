import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoAlarmState } from '../src/demo-alarm.ts';
import { AlarmSound } from '../src/alarm-sound.ts';

const target={id:'vibration',name:'齿轮箱振动',partLabel:'齿轮箱',alarm:8,precision:2,unit:'mm/s'};
test('demonstration starts normal and only an explicit signal raises an alarm',()=>{
  const state=new DemoAlarmState();assert.equal(state.active,null);assert.equal(state.valueFor(target.id,3.2),3.2);
  const signal=state.raise(target,123);assert.ok(signal.value>8);assert.equal(signal.raisedAt,123);
  assert.notEqual(signal.target,target);
  for(const normal of[3.1,3.2,3.3])assert.equal(state.valueFor(target.id,normal),signal.value);
  assert.equal(state.valueFor('other',2),2);
});
test('mute does not clear the fault, replacing a signal releases its former sensor, clearing restores normal',()=>{
  const state=new DemoAlarmState();state.raise(target);state.muted=true;assert.ok(state.valueFor(target.id,3)>8);
  const next={...target,id:'temperature',alarm:85,precision:1};state.raise(next);assert.equal(state.muted,false);
  assert.equal(state.valueFor(target.id,3),3);assert.ok(state.valueFor(next.id,66)>85);
  state.clear();assert.equal(state.active,null);assert.equal(state.valueFor(next.id,66),66);assert.equal(state.muted,false);
});

test('clearing while audio permission is pending cannot restart the sound later',async()=>{
  let resume,oscillators=0;
  class PendingAudio{
    state='suspended';
    createAnalyser(){return {connect(){},getFloatTimeDomainData(values){values.fill(0);}};}
    resume(){return new Promise(resolve=>{resume=()=>{this.state='running';resolve();};});}
    createOscillator(){oscillators++;throw new Error('Must not create audio after clear');}
  }
  const previous=globalThis.window;globalThis.window={AudioContext:PendingAudio};
  try{
    const sound=new AlarmSound(()=>{}),starting=sound.start();sound.stop();resume();await starting;
    assert.equal(oscillators,0);assert.equal(sound.diagnostics().state,'idle');assert.equal(sound.diagnostics().timerActive,false);
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
