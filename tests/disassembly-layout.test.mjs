import test from 'node:test';
import assert from 'node:assert/strict';
import { packRectangles,planPartLayout,smoothStep } from '../src/disassembly-layout.ts';
import { normalizeRotorSpeed } from '../src/rotor-speed.ts';

test('转速限定在演示范围，半转微调，无效输入恢复默认值',()=>{
  for(const [input,expected]of[[-1,0],[0,0],[5.2,5],[5.4,5.5],[20,20],[999,20],[NaN,10],[Infinity,10]])assert.equal(normalizeRotorSpeed(input),expected);
});
test('所有零件实例都有独立平铺位置，同型号不同实例不会合并丢失',()=>{
  const parts=Array.from({length:6383},(_,i)=>({id:`part-${i}`,system:`分组${i%16}`,size:.001+(i%317)/5}));
  const layout=planPartLayout(parts);assert.equal(layout.positions.size,parts.length);
  const cells=new Set();
  for(const part of parts){const tile=layout.positions.get(part.id);assert.ok(tile);assert.ok(Number.isFinite(tile.scale));assert.ok(Math.abs(tile.scale*part.size-2.1)<1e-10);cells.add(`${tile.x.toFixed(6)},${tile.y.toFixed(6)}`);}
  assert.equal(cells.size,parts.length);assert.equal(layout.sections.reduce((sum,s)=>sum+s.count,0),parts.length);
  assert.deepEqual(planPartLayout(parts),layout);
});
test('平铺零件包围盒之间保留间隙，切换筛选后重新紧凑排列',()=>{
  const parts=Array.from({length:60},(_,i)=>({id:String(i),system:`分组${i%3}`,size:i+1}));
  const layout=planPartLayout(parts),tiles=[...layout.positions.values()];
  for(let i=0;i<tiles.length;i++)for(let j=i+1;j<tiles.length;j++)assert.ok(Math.abs(tiles[i].x-tiles[j].x)>=3.19||Math.abs(tiles[i].y-tiles[j].y)>=3.19);
  const filtered=planPartLayout(parts.slice(0,1));assert.equal(filtered.positions.size,1);assert.equal(filtered.sections[0].count,1);
});
test('空筛选可显示空态，分解缓动端点可精确复原',()=>{
  assert.equal(planPartLayout([]).positions.size,0);
  assert.equal(smoothStep(0),0);assert.equal(smoothStep(1),1);assert.equal(smoothStep(-1),0);assert.equal(smoothStep(2),1);
  let previous=0;for(let i=0;i<=100;i++){const value=smoothStep(i/100);assert.ok(value>=previous);previous=value;}
});
test('竖屏减少平铺列数，横屏增加列数以利用可见空间',()=>{
  const items=Array.from({length:133},(_,i)=>({id:String(i),system:'齿轮箱',size:1}));
  const portrait=planPartLayout(items,.6),landscape=planPartLayout(items,4);
  assert.ok(portrait.columns<landscape.columns);assert.equal(portrait.positions.size,133);assert.equal(landscape.positions.size,133);
});
test('展开布局保留相同零件的全部实例并避免投影矩形重叠',()=>{
  const rectangles=Array.from({length:90},(_,i)=>({id:String(i),x:200+(i%4)*10,y:160+(i%7)*5,width:20+(i%3)*8,height:24+(i%4)*4}));
  const packed=packRectangles(rectangles,12);assert.equal(packed.size,rectangles.length);
  for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i],b=rectangles[j],pa=packed.get(a.id),pb=packed.get(b.id);
    assert.ok(Math.abs(pa.x-pb.x)>=(a.width+b.width)/2+11.99||Math.abs(pa.y-pb.y)>=(a.height+b.height)/2+11.99);
  }
});
