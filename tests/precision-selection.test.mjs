import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureSurfacePoint,surfaceWorldPoint,surfaceWorldBounds,SurfaceTapSequence,precisionFocusPlan} from '../src/precision-selection.ts';
import {pointWorldMatrix} from '../src/spatial-anchors.ts';

test('第二击沿用首击的表面，不会被选择变色或旋转后的新命中替换',()=>{
  const taps=new SurfaceTapSequence(),first={id:'bolt-1'},second={id:'shell'};
  assert.deepEqual(taps.tap(50,60,100,'mouse',first),{double:false,value:first});
  assert.deepEqual(taps.tap(52,61,320,'mouse',second),{double:true,value:first});
  assert.equal(taps.tap(52,61,400,'mouse',second).double,false);
});
test('拖动清理、多指、远处点击和超时不会误判为双击',()=>{
  const taps=new SurfaceTapSequence();taps.tap(0,0,0,'mouse',1);taps.clear();
  assert.equal(taps.tap(0,0,200,'mouse',1).double,false);
  assert.equal(taps.tap(0,0,250,'touch',1).double,false);
  assert.equal(taps.tap(40,0,300,'touch',1).double,false);
  assert.equal(taps.tap(40,0,1000,'touch',1).double,false);
});
test('同形小零件保留独立实例与真实表面点，旋转后仍跟随原零件',()=>{
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial(),2);
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(3,0,0));
  mesh.rotation.z=.4;mesh.scale.set(2,1,.5);mesh.updateMatrixWorld(true);
  const local=new THREE.Vector3(.05,.02,.01),world=local.clone().applyMatrix4(pointWorldMatrix(mesh,1));
  const captured=captureSurfacePoint({object:mesh,instanceId:1,point:world,face:{normal:new THREE.Vector3(1,0,0)}});
  assert.ok(captured.localPosition.distanceTo(local)<1e-12);
  assert.ok(surfaceWorldBounds(captured).getSize(new THREE.Vector3()).length()<.4);
  mesh.rotation.z=1;assert.ok(surfaceWorldPoint(captured).distanceTo(local.clone().applyMatrix4(pointWorldMatrix(mesh,1)))<1e-12);
});
const camera=new THREE.PerspectiveCamera(34,1.6,.01,1000);camera.position.set(0,0,30);
const common={camera,direction:new THREE.Vector3(0,0,1),frame:{width:1100,height:700},viewportHeight:900,referenceSpan:24};
test('叶片聚焦双击处的局部区域，不把整片叶片拉远',()=>{
  const point=new THREE.Vector3(9,0,.1),bounds=new THREE.Box3(new THREE.Vector3(-20,-.2,0),new THREE.Vector3(20,.2,.2));
  const plan=precisionFocusPlan({...common,bounds,point,forceLocal:true});
  assert.ok(plan.local);assert.ok(plan.center.distanceTo(point)<1e-10);assert.ok(plan.distance<15);assert.ok(plan.bounds.getSize(new THREE.Vector3()).x<4);
});
test('微小零件按单件范围放大，并且在窄视口中能完整容纳',()=>{
  const bounds=new THREE.Box3(new THREE.Vector3(-.02,-.015,-.01),new THREE.Vector3(.02,.015,.01));
  const plan=precisionFocusPlan({...common,bounds,point:new THREE.Vector3(0,0,.01),frame:{width:360,height:500}});
  assert.equal(plan.local,false);assert.ok(plan.distance>.05&&plan.distance<.3);
  const projected=camera.clone();projected.position.copy(plan.position);projected.lookAt(plan.center);projected.updateMatrixWorld();
  for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y]){
    const p=new THREE.Vector3(x,y,.01).project(projected);assert.ok(Math.abs(p.x)<360/(900*projected.aspect)&&Math.abs(p.y)<500/900);
  }
});
test('连续双击同一叶片表面只继续放大，不会退回整片叶片视图',()=>{
  const point=new THREE.Vector3(9,0,.1),bounds=new THREE.Box3(new THREE.Vector3(-20,-.2,0),new THREE.Vector3(20,.2,.2));
  const first=precisionFocusPlan({...common,bounds,point,forceLocal:true});
  const closer=camera.clone();closer.position.copy(first.position);closer.lookAt(first.center);closer.updateMatrixWorld();
  const second=precisionFocusPlan({...common,camera:closer,bounds,point,forceLocal:true});
  assert.ok(second.distance<first.distance*.9);assert.ok(second.center.distanceTo(point)<1e-10);
});
