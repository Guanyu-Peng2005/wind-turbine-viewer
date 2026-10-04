import test from 'node:test';
import assert from 'node:assert/strict';
import { Group } from 'three';
import { frameAssemblyAttachments } from '../src/frame-assembly.ts';

const named=name=>{const node=new Group();node.name=name;return node;};

test('front and rear frame plus their joint form one selection without reparenting',()=>{
  const base=named('W65D3-02-03-00#机舱座'),front=named('W65D3-02-03-01#主机架-1');
  const rear=named('W65D3-02-03-02#后机架-1'),bolt=named('1103#螺栓M30×130-109-dc71-1'),washer=named('1103#垫圈30-300HV-1_1');
  const tray=named('电缆桥架Ⅱ-1'),trayBolt=named('螺栓M12×25-109-dc71-1'),guard=named('后机架防护板X-1'),guardBracket=named('后机架护板支撑-1');
  base.add(front,rear,bolt,washer,tray,trayBolt,guard,guardBracket);
  const children=base.children.slice();
  assert.deepEqual(frameAssemblyAttachments(front),[rear,bolt,washer]);
  assert.deepEqual(base.children,children);
  assert.ok(children.every(node=>node.parent===base));
});

test('similarly named parts outside the nacelle base are not absorbed',()=>{
  const other=named('机舱防护系统'),front=named('主机架-1'),rear=named('后机架-1');
  other.add(front,rear);assert.deepEqual(frameAssemblyAttachments(front),[]);
  assert.deepEqual(frameAssemblyAttachments(named('主机架-1')),[]);
});
