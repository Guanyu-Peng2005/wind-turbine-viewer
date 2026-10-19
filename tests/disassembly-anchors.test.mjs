import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { captureDisassemblySurface, disassembledAnchor } from '../src/disassembly-anchors.ts';

const close=(actual,expected)=>assert.ok(actual.distanceTo(expected)<1e-9,`${actual.toArray()} != ${expected.toArray()}`);
const transform=(position,rotation,scale)=>new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));

test('分解表面标定逆变换回原始零件局部坐标，不保存爆炸位移',()=>{
  const geometry=new THREE.BoxGeometry(2,3,4),mesh=new THREE.Mesh(geometry),local=new THREE.Vector3(1,.7,-.4);
  const snapshot=transform([4,2,8],[.2,.6,-.4],[2,3,.5]);
  const layout=transform([-8,6,2],[0,0,0],[1,1,1]);
  const point=disassembledAnchor(local.toArray(),snapshot,layout);
  const surface=captureDisassemblySurface({point,instanceId:57,face:{normal:new THREE.Vector3(1,0,0)}},{mesh},snapshot,layout,geometry);
  close(surface.localPosition,local);assert.equal(surface.instanceId,undefined);assert.equal(surface.mesh,mesh);assert.equal(surface.geometry,geometry);
  close(disassembledAnchor(surface.localPosition.toArray(),snapshot,new THREE.Matrix4()),local.clone().applyMatrix4(snapshot));
});

test('相同几何体的多个实例保持各自绑定，批次编号不能替代源实例编号',()=>{
  const geometry=new THREE.BoxGeometry(),mesh=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial(),3);
  const parent=transform([10,2,3],[.1,.4,.2],[1,2,1]),local=new THREE.Vector3(.5,.2,-.1),layout=transform([7,-3,4],[.2,0,.3],[.4,.4,.4]);
  for(let instanceId=0;instanceId<3;instanceId++){
    const snapshot=parent.clone().multiply(new THREE.Matrix4().makeTranslation(instanceId*5,0,0));
    const surface=captureDisassemblySurface({point:disassembledAnchor(local.toArray(),snapshot,layout),instanceId:500+instanceId,face:{normal:new THREE.Vector3(1,0,0)}},{mesh,instanceId},snapshot,layout,geometry);
    assert.equal(surface.instanceId,instanceId);close(surface.localPosition,local);
  }
});

test('标定与报警共用表面坐标，在装配、展开和平铺各阶段位置一致且不修改源模型',()=>{
  const snapshot=transform([3,4,5],[.4,.2,.7],[1,2,3]),saved=snapshot.toArray(),point=[.2,.3,.4];
  for(const progress of[0,.25,.5,1]){
    const layout=transform([progress*20,-progress*10,progress*3],[0,0,0],[1-progress*.8,1-progress*.8,1-progress*.8]);
    const annotation=disassembledAnchor(point,snapshot,layout),alarm=disassembledAnchor([...point],snapshot,layout);
    close(annotation,alarm);close(annotation,new THREE.Vector3(...point).applyMatrix4(new THREE.Matrix4().multiplyMatrices(layout,snapshot)));
  }
  assert.deepEqual(snapshot.toArray(),saved);
});

test('退化显示变换不会生成无效的持久化标定坐标',()=>{
  const geometry=new THREE.BoxGeometry(),mesh=new THREE.Mesh(geometry);
  assert.equal(captureDisassemblySurface({point:new THREE.Vector3(),face:{normal:new THREE.Vector3(1,0,0)}},{mesh},new THREE.Matrix4(),new THREE.Matrix4().makeScale(0,0,0),geometry),null);
});
