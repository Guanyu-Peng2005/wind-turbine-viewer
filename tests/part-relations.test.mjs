import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_RELATIONS, equipmentContext } from '../src/part-relations.ts';

const chain=['叶片','轮毂总成','主轴组件','齿轮箱','高速轴联轴器','发电机','辅助变压器'];
const auxiliary=['主轴承','主机架','液压系统','高速轴制动器','偏航系统','机舱外壳'];
const available=new Set([...chain,...auxiliary]);

test('all edges connect known, distinct parts and are unique',()=>{
  const keys=new Set();
  for(const e of EQUIPMENT_RELATIONS){
    assert.ok(available.has(e.from)&&available.has(e.to));assert.notEqual(e.from,e.to);
    const key=`${e.kind}/${e.from}/${e.to}`;assert.ok(!keys.has(key));keys.add(key);
  }
});

for(const [index,name] of chain.entries())test(`${name}: upstream and downstream follow the energy path`,()=>{
  const c=equipmentContext(name,available);
  assert.deepEqual([...c.upstream.keys()],chain.slice(0,index).reverse());
  assert.deepEqual([...c.downstream.keys()],chain.slice(index+1));
  assert.equal(c.roles.get(name),'current');
  for(const [direction,paths]of [['upstream',c.upstreamPaths],['downstream',c.downstreamPaths]]){
    for(const [neighbor,path]of paths){
      assert.equal(path.length,c[direction].get(neighbor));
      assert.equal(path[0].from,direction==='upstream'?neighbor:name);
      assert.equal(path.at(-1).to,direction==='upstream'?name:neighbor);
      path.forEach((e,i)=>{assert.ok(e.kind==='mechanical'||e.kind==='electrical');if(i)assert.equal(path[i-1].to,e.from);});
    }
  }
});

test('supports, controls and covers are not shaft-power nodes',()=>{
  for(const name of auxiliary){const c=equipmentContext(name,available);assert.equal(c.upstream.size,0);assert.equal(c.downstream.size,0);}
});

test('the frame supports the generator, never the reverse',()=>{
  const gen=equipmentContext('发电机',available),frame=equipmentContext('主机架',available);
  const incoming=gen.related.find(r=>r.kind==='support');
  assert.deepEqual([incoming.from,incoming.to,incoming.direction],['主机架','发电机','incoming']);
  assert.deepEqual(frame.related.filter(r=>r.kind==='support'&&r.distance===1).map(r=>[r.label,r.direction]),[['主轴承','outgoing'],['齿轮箱','outgoing'],['发电机','outgoing'],['辅助变压器','outgoing'],['液压系统','outgoing']]);
});

test('the main bearing supports the shaft and is itself supported by the frame',()=>{
  const c=equipmentContext('主轴承',available);
  assert.deepEqual(c.related.map(r=>[r.label,r.direction]),[['主轴组件','outgoing'],['主机架','incoming']]);
  assert.equal(equipmentContext('主轴组件',available).roles.get('主轴承'),'related');
});

test('the shaft and frame show their indirect support through the main bearing',()=>{
  const shaft=equipmentContext('主轴组件',available),frame=equipmentContext('主机架',available);
  const incoming=shaft.related.find(r=>r.label==='主机架'&&r.kind==='support');
  const outgoing=frame.related.find(r=>r.label==='主轴组件'&&r.kind==='support');
  assert.ok(incoming);assert.ok(outgoing);
  assert.equal(incoming.distance,2);assert.equal(incoming.direction,'incoming');
  assert.equal(outgoing.distance,2);assert.equal(outgoing.direction,'outgoing');
  assert.deepEqual(incoming.path.map(e=>[e.from,e.to]),[['主机架','主轴承'],['主轴承','主轴组件']]);
  assert.deepEqual(incoming.path,outgoing.path);
  assert.equal(shaft.roles.get('主机架'),'related');assert.equal(frame.roles.get('主轴组件'),'related');
  assert.ok(!shaft.upstream.has('主机架'));assert.ok(!frame.downstream.has('主轴组件'));
  assert.ok(!EQUIPMENT_RELATIONS.some(e=>e.from==='主机架'&&e.to==='主轴组件'),'Do not insert a false direct mounting edge');
});

test('support paths contain only contiguous supports and never link sibling equipment',()=>{
  for(const name of available){
    const c=equipmentContext(name,available),keys=new Set();
    for(const r of c.related){
      const key=`${r.kind}/${r.direction}/${r.label}`;
      assert.ok(!keys.has(key));keys.add(key);assert.notEqual(r.label,name);
      assert.equal(r.path.length,r.distance);
      assert.equal(r.path[0].from,r.from);assert.equal(r.path.at(-1).to,r.to);
      assert.equal(r.direction==='incoming'?r.to:r.from,name);
      r.path.forEach((e,i)=>{assert.equal(e.kind,r.kind);if(i)assert.equal(r.path[i-1].to,e.from);});
      if(r.kind!=='support')assert.equal(r.distance,1);
    }
  }
  const gen=equipmentContext('发电机',available);
  assert.deepEqual(gen.related.filter(r=>r.kind==='support').map(r=>r.label),['主机架']);
  assert.ok(!equipmentContext('主轴组件',available).related.some(r=>r.kind==='support'&&['偏航系统','机舱外壳','发电机'].includes(r.label)));
});

test('a missing bearing breaks the indirect support path rather than implying direct support',()=>{
  const reduced=new Set(available);reduced.delete('主轴承');
  const shaft=equipmentContext('主轴组件',reduced),frame=equipmentContext('主机架',reduced);
  assert.ok(!shaft.related.some(r=>r.label==='主机架'));
  assert.ok(!frame.related.some(r=>r.label==='主轴组件'));
  assert.equal(shaft.supportNote,'装配支承未单列');
});

test('covers protect equipment; yaw and hydraulics provide auxiliary actions',()=>{
  const cover=equipmentContext('机舱外壳',available);
  assert.ok(cover.related.every(r=>r.kind==='protection'&&r.direction==='outgoing'));
  assert.deepEqual(cover.related.map(r=>r.label),['齿轮箱','发电机','辅助变压器','液压系统']);
  const brake=equipmentContext('高速轴制动器',available);
  assert.deepEqual(brake.related.map(r=>[r.label,r.kind,r.direction]),[['高速轴联轴器','service','outgoing'],['液压系统','service','incoming']]);
  assert.equal(equipmentContext('偏航系统',available).related[0].kind,'service');
});

test('the requested electrical presentation connection is explicitly illustrative and reciprocal',()=>{
  const aux=equipmentContext('辅助变压器',available),gen=equipmentContext('发电机',available);
  assert.equal(aux.upstream.get('发电机'),1);assert.equal(aux.downstream.size,0);
  assert.equal(gen.downstream.get('辅助变压器'),1);
  const electrical=EQUIPMENT_RELATIONS.filter(e=>e.kind==='electrical');
  assert.equal(electrical.length,1);assert.equal(electrical[0].illustrative,true);
  assert.deepEqual(aux.upstreamPaths.get('发电机'),gen.downstreamPaths.get('辅助变压器'));
  assert.equal(aux.roles.get('发电机'),'upstream');assert.equal(gen.roles.get('辅助变压器'),'downstream');
  assert.equal(aux.emptyDownstream,'后续电路未展示');
});

test('rear-frame equipment has incoming support and enclosure protection',()=>{
  for(const name of ['辅助变压器','液压系统']){
    const c=equipmentContext(name,available);
    assert.ok(c.related.some(r=>r.label==='主机架'&&r.kind==='support'&&r.direction==='incoming'&&r.from==='主机架'&&r.to===name));
    assert.ok(c.related.some(r=>r.label==='机舱外壳'&&r.kind==='protection'&&r.direction==='incoming'));
    assert.equal(c.roles.get('主机架'),'related');
    assert.equal(c.supportNote,null);
  }
});

test('an unlisted support is explicitly distinguished from no physical support',()=>{
  assert.equal(equipmentContext('主机架',available).supportNote,'装配支承未单列');
  assert.equal(equipmentContext('发电机',available).supportNote,null);
});

test('relation directions are reciprocal from either selection',()=>{
  for(const name of available)for(const r of equipmentContext(name,available).related){
    const reverse=equipmentContext(r.label,available).related.find(e=>e.label===name&&e.kind===r.kind);
    assert.ok(reverse);assert.equal(reverse.from,r.from);assert.equal(reverse.to,r.to);assert.notEqual(reverse.direction,r.direction);
    assert.equal(reverse.distance,r.distance);assert.deepEqual(reverse.path,r.path);
  }
});

test('a missing model part is not replaced with an invented connection',()=>{
  const reduced=new Set(available);reduced.delete('主轴组件');
  assert.equal(equipmentContext('齿轮箱',reduced).upstream.size,0);
  assert.ok(!equipmentContext('轮毂总成',reduced).downstream.has('齿轮箱'));
});
