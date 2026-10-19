import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDisassemblyScope } from '../src/disassembly-entry.ts';

test('从整机直接下钻到选中总成的第一层部件，不先展开整台风机',()=>{
  const entries=[{system:'发电机',cluster:'机座与外壳'},{system:'发电机',cluster:'转子总成'},{system:'发电机',cluster:'轴承组件'},{system:'齿轮箱',cluster:'箱体'}];
  assert.deepEqual(initialDisassemblyScope(entries,'发电机'),{system:'发电机',cluster:null});
});

test('单一中间分组自动下钻一层，但相同名称的独立实物仍保留',()=>{
  const entries=Array.from({length:3},()=>({system:'叶片',cluster:'叶片'}));
  assert.deepEqual(initialDisassemblyScope(entries,'叶片'),{system:'叶片',cluster:'叶片'});
  assert.equal(entries.length,3);
});

test('整体零件停留在对应总成内，不退回整机并伪造分解',()=>{
  const entries=[{system:'高速轴联轴器',cluster:'联轴器总成'}];
  assert.deepEqual(initialDisassemblyScope(entries,'高速轴联轴器'),{system:'高速轴联轴器',cluster:null});
});

test('普通分解入口和无效链接仍安全进入主要总成层级',()=>{
  const entries=[{system:'发电机',cluster:'转子总成'}];
  for(const requested of ['', '不存在的总成'])assert.deepEqual(initialDisassemblyScope(entries,requested),{system:'',cluster:null});
  assert.deepEqual(initialDisassemblyScope([], '发电机'),{system:'',cluster:null});
});
