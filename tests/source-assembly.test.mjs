import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync } from 'node:fs';
import { EQUIPMENT_RELATIONS, equipmentContext } from '../src/part-relations.ts';
import { frameAssemblyAttachments } from '../src/frame-assembly.ts';

// Read only the GLB JSON chunk. These checks use the actual supplied assembly,
// rather than repeating the relationship table as their only source of truth.
const fd=openSync(new URL('../public/models/wind-turbine-cad.glb',import.meta.url),'r');
let gltf;
try{
  const header=Buffer.alloc(20);readSync(fd,header,0,20,0);
  assert.equal(header.readUInt32LE(0),0x46546c67);assert.equal(header.readUInt32LE(16),0x4e4f534a);
  const chunk=Buffer.alloc(header.readUInt32LE(12));readSync(fd,chunk,0,chunk.length,20);gltf=JSON.parse(chunk.toString('utf8'));
}finally{closeSync(fd);}
const nodes=gltf.nodes.map(n=>({name:n.name??'',children:[],parent:null}));
gltf.nodes.forEach((n,i)=>(n.children??[]).forEach(j=>{nodes[i].children.push(nodes[j]);nodes[j].parent=nodes[i];}));
const name=n=>n.name.split('#').at(-1);

test('the supplied transformer is explicitly under an auxiliary-transformer assembly',()=>{
  const aux=nodes.find(n=>/^辅助变压器(?:-\d+)?$/.test(name(n)));
  assert.ok(aux,'Missing source auxiliary-transformer assembly');
  assert.ok(aux.children.some(n=>/^变压器(?:-\d+)?$/.test(name(n))));
  assert.ok(EQUIPMENT_RELATIONS.filter(e=>e.kind==='electrical'&&/变压器/.test(e.to)).every(e=>e.illustrative===true),'Presentation connections must not claim to be source CAD wiring');
  const context=equipmentContext('辅助变压器',new Set(['辅助变压器','主机架','机舱外壳','发电机']));
  assert.ok(context.upstreamPaths.get('发电机').some(e=>e.illustrative));
});

test('the source front/rear frame boundary is preserved by the frame selection',()=>{
  const front=nodes.find(n=>/^主机架(?:-\d+)?$/.test(name(n)));
  assert.ok(front);assert.match(name(front.parent),/^机舱座/);
  const attachments=frameAssemblyAttachments(front);
  assert.ok(attachments.some(n=>/^后机架(?:-\d+)?$/.test(name(n))));
  assert.ok(attachments.every(n=>n.parent===front.parent));
  assert.ok(!attachments.some(n=>/桥架|防护板/.test(name(n))));
});

test('the hydraulic station has an actual source installation bracket',()=>{
  const brackets=nodes.filter(n=>/液压站安装架/.test(name(n)));
  assert.ok(brackets.some(bracket=>{
    for(let n=bracket.parent;n;n=n.parent)if(/^液压系统/.test(name(n)))return true;
    return false;
  }),'Installation bracket must belong to the hydraulic assembly, not only a duplicated loose part');
  assert.ok(EQUIPMENT_RELATIONS.some(e=>e.from==='主机架'&&e.to==='液压系统'&&e.kind==='support'));
});
