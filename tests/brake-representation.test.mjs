import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { brakeDisplayVariants } from '../src/brake-representation.ts';

test('同一安装位置的完整制动器替代表示不会作为三个内部子件展示',()=>{
  const root=new THREE.Group();const nodes=['10010011498','10010011607','10010011499'].map((code,i)=>{const node=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));node.name=code+'#高速轴制动器-1';node.position.x=i*.015;root.add(node);return node;});
  const result=brakeDisplayVariants(nodes);assert.equal(result.canonical,nodes[0]);assert.deepEqual([...result.hidden],[nodes[1],nodes[2]]);
  assert.ok(nodes.every(n=>n.visible));assert.equal(root.children.length,3);
});
test('同型号但安装在不同位置或不同总成的真实实例不被移除',()=>{
  const root=new THREE.Group(),otherRoot=new THREE.Group();
  const create=(code,parent,x)=>{const n=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));n.name=code+'#高速轴制动器-1';n.position.x=x;parent.add(n);return n;};
  const canonical=create('10010011498',root,0),remote=create('10010011607',root,2),otherAssembly=create('10010011499',otherRoot,0);
  assert.equal(brakeDisplayVariants([canonical,remote,otherAssembly]).hidden.size,0);
  assert.equal(brakeDisplayVariants([remote]).hidden.size,0);
});
