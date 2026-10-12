export type LayoutItem={id:string;system:string;size:number};
export type TilePosition={x:number;y:number;scale:number};
export type LayoutSection={name:string;x:number;y:number;count:number};
export function smoothStep(value:number):number{const t=Math.min(1,Math.max(0,value));return t*t*(3-2*t);}

export type PartRectangle={id:string;x:number;y:number;width:number;height:number};
/** 按屏幕占用空间寻找最近的不重叠位置，不按型号合并实际实例。 */
export function packRectangles(rectangles:PartRectangle[],gap=12,frame?:{left:number;right:number;top:number;bottom:number}):Map<string,{x:number;y:number}>{
  const output=new Map<string,{x:number;y:number}>(),placed:PartRectangle[]=[];
  const widths=rectangles.map(r=>Math.max(r.width,r.height)).sort((a,b)=>a-b),cell=Math.max(16,widths[Math.floor(widths.length/2)]??32);
  const grid=new Map<string,PartRectangle[]>();
  const keys=(r:PartRectangle)=>{const result:string[]=[];for(let x=Math.floor((r.x-r.width/2-gap)/cell);x<=Math.floor((r.x+r.width/2+gap)/cell);x++)for(let y=Math.floor((r.y-r.height/2-gap)/cell);y<=Math.floor((r.y+r.height/2+gap)/cell);y++)result.push(x+','+y);return result;};
  const fits=(r:PartRectangle)=>{const nearby=new Set<PartRectangle>();for(const key of keys(r))for(const p of grid.get(key)??[])nearby.add(p);return ![...nearby].some(p=>Math.abs(r.x-p.x)<(r.width+p.width)/2+gap-.001&&Math.abs(r.y-p.y)<(r.height+p.height)/2+gap-.001);};
  for(const source of [...rectangles].sort((a,b)=>b.width*b.height-a.width*a.height)){
    let best={...source},cost=Infinity;
    if(frame){best.x=Math.max(frame.left+source.width/2,Math.min(frame.right-source.width/2,best.x));best.y=Math.max(frame.top+source.height/2,Math.min(frame.bottom-source.height/2,best.y));}
    const score=(candidate:{x:number;y:number})=>{let value=(candidate.x-source.x)**2+(candidate.y-source.y)**2;if(frame)value+=100*(Math.max(0,frame.left-candidate.x+source.width/2)**2+Math.max(0,candidate.x+source.width/2-frame.right)**2+Math.max(0,frame.top-candidate.y+source.height/2)**2+Math.max(0,candidate.y+source.height/2-frame.bottom)**2);return value;};
    if(fits(best))cost=0;
    else{
      const neighbors=[...placed].sort((a,b)=>(a.x-source.x)**2+(a.y-source.y)**2-((b.x-source.x)**2+(b.y-source.y)**2)).slice(0,48);
      const candidates:Array<{x:number;y:number}>=[];
      for(const p of neighbors){const dx=(p.width+source.width)/2+gap,dy=(p.height+source.height)/2+gap;for(const sign of[-1,1]){candidates.push({x:p.x+sign*dx,y:source.y},{x:p.x+sign*dx,y:p.y},{x:source.x,y:p.y+sign*dy},{x:p.x,y:p.y+sign*dy});}}
      if(frame)for(const x of[frame.left+source.width/2,frame.right-source.width/2])for(const y of[frame.top+source.height/2,frame.bottom-source.height/2])candidates.push({x,y});
      for(const candidate of candidates){const distance=score(candidate);if(distance<cost&&fits({...source,...candidate})){best={...source,...candidate};cost=distance;}}
      if(!Number.isFinite(cost))best.x=Math.max(...placed.map(p=>p.x+p.width/2))+gap+source.width/2;
    }
    placed.push(best);for(const key of keys(best)){const list=grid.get(key)??[];list.push(best);grid.set(key,list);}output.set(best.id,{x:best.x,y:best.y});
  }
  return output;
}

/** 每个实际零件实例独占一格；局部缩放只用于平铺阅读，不更改模型尺寸。 */
export function planPartLayout(items:LayoutItem[],aspect=1.45){
  const positions=new Map<string,TilePosition>(),sections:LayoutSection[]=[];
  const systems=new Map<string,LayoutItem[]>();
  for(const item of items){const group=systems.get(item.system)??[];group.push(item);systems.set(item.system,group);}
  const ratio=Math.min(6,Math.max(.25,aspect)),padding=systems.size*2;
  const columns=Math.max(3,Math.ceil((ratio*padding+Math.sqrt((ratio*padding)**2+4*ratio*Math.max(items.length,1)))/2));
  let row=0;
  for(const [name,group] of systems){
    sections.push({name,x:-columns*1.6,y:-row*3.2+1.7,count:group.length});
    group.forEach((item,index)=>positions.set(item.id,{x:((index%columns)-(columns-1)/2)*3.2,y:-(row+Math.floor(index/columns))*3.2,scale:2.1/Math.max(item.size,1e-8)}));
    row+=Math.ceil(group.length/columns)+1;
  }
  const centerY=-Math.max(0,row-2)*1.6;
  positions.forEach(position=>{position.y-=centerY;});sections.forEach(section=>{section.y-=centerY;});
  return {positions,sections,columns};
}
