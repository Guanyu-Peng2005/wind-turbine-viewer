import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { AnchorRegistry,anchorWorldPoint,pointWorldMatrix,finiteVector,validBinding } from '../src/spatial-anchors.ts';
import { surfaceAnchor,worldVisible } from '../src/spatial-index.ts';

test('stable anchors survive unrelated sibling insertion but reject a different model revision',()=>{
  const root=new THREE.Group(),shaft=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry());
  shaft.name='main-shaft';mesh.name='bearing';root.add(shaft);shaft.add(mesh);
  const old=new AnchorRegistry([{id:'source',version:'one',root}]),binding=old.bind(mesh);
  root.children.unshift(new THREE.Group());
  assert.equal(new AnchorRegistry([{id:'source',version:'one',root}]).resolve(binding),mesh);
  assert.equal(new AnchorRegistry([{id:'source',version:'two',root}]).resolve(binding),null);
});

test('anchors identify the correct instance and follow compound rotation and nonuniform scale',()=>{
  const root=new THREE.Group();root.scale.set(2,.5,1.3);root.rotation.z=.3;
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);root.add(mesh);
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(1,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(4,1,0));
  const registry=new AnchorRegistry([{id:'generator',version:'v1',root}]),binding=registry.bind(mesh,1);
  const local=[.5,.2,-.3],world=anchorWorldPoint(mesh,local,binding);
  const restored=world.clone().applyMatrix4(pointWorldMatrix(mesh,1).invert());
  assert.ok(restored.distanceTo(new THREE.Vector3(...local))<1e-12);
  assert.ok(world.distanceTo(anchorWorldPoint(mesh,local,registry.bind(mesh,0)))>1);
  assert.equal(registry.resolve({...binding,instanceId:2}),null);
  root.rotation.x=.7;assert.ok(world.distanceTo(anchorWorldPoint(mesh,local,binding))>.1);
});

test('surface projection lands on the actual surface without changing index order',()=>{
  const geometry=new THREE.BoxGeometry(2,2,2),before=Array.from(geometry.index.array),mesh=new THREE.Mesh(geometry);
  geometry.boundsTree=new MeshBVH(geometry,{indirect:true});
  const hit=surfaceAnchor(mesh,new THREE.Vector3(.2,.3,.8));
  assert.ok(hit.position.distanceTo(new THREE.Vector3(.2,.3,1))<1e-7);
  assert.deepEqual(Array.from(geometry.index.array),before);
  assert.ok(Math.abs(hit.normal.length()-1)<1e-8);
});

test('visibility includes every ancestor and persisted coordinates must be finite',()=>{
  const parent=new THREE.Group(),mesh=new THREE.Mesh();parent.add(mesh);parent.visible=false;
  assert.equal(mesh.visible,true);assert.equal(worldVisible(mesh),false);parent.visible=true;assert.equal(worldVisible(mesh),true);
  for(const value of[[0,1,NaN],[0,'1',2],[1,Infinity,2],[1,2]])assert.equal(finiteVector(value),false);
  assert.equal(validBinding({rootId:'source',modelVersion:'v1',objectId:'shaft',instanceId:-1}),false);
});

test('an asynchronous anchor uses captured source geometry even if interaction LOD swaps the mesh',()=>{
  const source=new THREE.BoxGeometry(2,2,2),mesh=new THREE.Mesh(source);source.boundsTree=new MeshBVH(source,{indirect:true});
  mesh.geometry=new THREE.BoxGeometry(4,4,4);
  const anchor=surfaceAnchor(mesh,new THREE.Vector3(.1,.2,.8),source);
  assert.ok(anchor.position.distanceTo(new THREE.Vector3(.1,.2,1))<1e-7);
});

test('accelerated raycasting preserves instance ids and exact hit positions',()=>{
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);
  mesh.geometry.boundsTree=new MeshBVH(mesh.geometry,{indirect:true});
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(0,0,0));mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(3,0,0));mesh.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(3,0,4),new THREE.Vector3(0,0,-1)),hit=ray.intersectObject(mesh)[0];
  assert.equal(hit.instanceId,1);assert.ok(hit.point.distanceTo(new THREE.Vector3(3,0,.5))<1e-7);
});
