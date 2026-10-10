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
  let resume,sources=0;
  class PendingAudio{
    state='suspended';
    createAnalyser(){return {connect(){},getFloatTimeDomainData(values){values.fill(0);}};}
    resume(){return new Promise(resolve=>{resume=()=>{this.state='running';resolve();};});}
    createBufferSource(){sources++;throw new Error('Must not create audio after clear');}
  }
  const previous=globalThis.window;globalThis.window={AudioContext:PendingAudio};
  try{
    const sound=new AlarmSound(()=>{},'/audio/alarm.wav'),starting=sound.start();sound.stop();resume();await starting;
    assert.equal(sources,0);assert.equal(sound.diagnostics().state,'idle');assert.equal(sound.diagnostics().timerActive,false);
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function audioHarness(t,options={}){
  const previousWindow=globalThis.window,previousFetch=globalThis.fetch;
  const calls={fetch:0,decode:0,contexts:0,sources:[],buffer:{duration:1.846}};
  class AssetAudio{
    state='running';currentTime=0;
    constructor(){calls.contexts++;}
    createAnalyser(){return {connect(){},getFloatTimeDomainData(values){values.fill(0);}};}
    async decodeAudioData(bytes){calls.decode++;assert.ok(bytes instanceof ArrayBuffer);return options.decode?options.decode(calls):calls.buffer;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},disconnect(){}};}
    createBufferSource(){
      const source={started:false,stopped:false,disconnected:false,connect(){},start(){this.started=true;},stop(){this.stopped=true;},disconnect(){this.disconnected=true;}};
      calls.sources.push(source);return source;
    }
    async close(){this.state='closed';}
  }
  globalThis.window={AudioContext:AssetAudio};
  globalThis.fetch=async url=>{assert.equal(url,'/wind-turbine-viewer/audio/alarm.wav');calls.fetch++;return options.fetch?options.fetch(calls):{ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
  t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;globalThis.fetch=previousFetch;});
  return {calls,sound:new AlarmSound(()=>{},'/wind-turbine-viewer/audio/alarm.wav')};
}

test('preloading stays silent, then playback loops the cached asset without stacked audio',async t=>{
  const {sound,calls}=audioHarness(t);sound.preload();
  assert.equal(calls.contexts,0);assert.equal(sound.diagnostics().state,'idle');
  await sound.start();assert.equal(sound.diagnostics().state,'playing');
  assert.equal(calls.sources[0].buffer,calls.buffer);assert.equal(calls.sources[0].loop,true);
  await sound.start();assert.equal(calls.sources[0].stopped,true);assert.equal(calls.sources[0].disconnected,true);
  assert.equal(sound.diagnostics().activeNodes,1);assert.equal(calls.fetch,1);assert.equal(calls.decode,1);
  sound.stop(true);assert.equal(sound.diagnostics().state,'muted');assert.equal(sound.diagnostics().activeNodes,0);
  assert.equal(calls.sources[1].stopped,true);assert.equal(sound.diagnostics().signalPeak,0);sound.dispose();
});

test('muting during the download prevents delayed playback',async t=>{
  const download=deferred();const {sound,calls}=audioHarness(t,{fetch:()=>download.promise});
  const starting=sound.start();sound.stop(true);
  download.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});await starting;
  assert.equal(sound.diagnostics().state,'muted');assert.equal(calls.sources.length,0);sound.dispose();
});

test('repeated signals share pending decoding and only the latest signal starts playback',async t=>{
  const decoding=deferred(),entered=deferred();const {sound,calls}=audioHarness(t,{decode:()=>{entered.resolve();return decoding.promise;}});
  const first=sound.start();await entered.promise;const second=sound.start(),third=sound.start();
  decoding.resolve(calls.buffer);await Promise.all([first,second,third]);
  assert.equal(calls.fetch,1);assert.equal(calls.decode,1);assert.equal(calls.sources.length,1);
  assert.equal(sound.diagnostics().state,'playing');sound.dispose();
});

test('clearing or leaving during decoding cannot restart a stopped alarm',async t=>{
  const decoding=deferred(),entered=deferred();const {sound,calls}=audioHarness(t,{decode:()=>{entered.resolve();return decoding.promise;}});
  const starting=sound.start();await entered.promise;sound.dispose();decoding.resolve(calls.buffer);await starting;
  assert.equal(calls.sources.length,0);assert.equal(sound.diagnostics().state,'idle');assert.equal(sound.diagnostics().assetLoaded,false);
});

test('download and decoding failures remain silent and can be retried',async t=>{
  const {sound,calls}=audioHarness(t,{
    fetch:calls=>({ok:calls.fetch>1,arrayBuffer:async()=>new ArrayBuffer(8)}),
    decode:calls=>{if(calls.decode===1)throw new Error('Invalid audio');return calls.buffer;},
  });
  await sound.start();assert.equal(sound.diagnostics().state,'failed');assert.equal(calls.sources.length,0);
  await sound.start();assert.equal(sound.diagnostics().state,'failed');assert.equal(calls.sources.length,0);
  await sound.start();assert.equal(sound.diagnostics().state,'playing');assert.equal(calls.sources.length,1);
  assert.equal(calls.fetch,3);assert.equal(calls.decode,2);sound.dispose();
});
