export type RelationRole='current'|'upstream'|'downstream'|'related'|'context';
// For non-power edges, from is the provider and to is the supported/served part.
export type EquipmentRelation={from:string;to:string;kind:'mechanical'|'electrical'|'support'|'service'|'protection';label:string;illustrative?:true};
type RelatedPart={
  label:string;description:string;kind:EquipmentRelation['kind'];
  from:string;to:string;direction:'incoming'|'outgoing';
  distance:number;path:EquipmentRelation[];
};

// Typical geared-turbine functional relationships, not manufacturer wiring or a
// claim that stationary bearings, calipers and supports transmit shaft rotation.
export const EQUIPMENT_RELATIONS:EquipmentRelation[]=[
  {from:'叶片',to:'轮毂总成',kind:'mechanical',label:'叶片驱动轮毂'},
  {from:'轮毂总成',to:'主轴组件',kind:'mechanical',label:'低速旋转输入'},
  {from:'主轴组件',to:'齿轮箱',kind:'mechanical',label:'输入转矩'},
  {from:'齿轮箱',to:'高速轴联轴器',kind:'mechanical',label:'增速输出'},
  {from:'高速轴联轴器',to:'发电机',kind:'mechanical',label:'驱动发电机转子'},
  // Retain the user's requested presentation connection. The CAD identifies an
  // auxiliary transformer, so this edge is illustrative, not verified wiring.
  {from:'发电机',to:'辅助变压器',kind:'electrical',label:'电气关系示意（沿用演示连接，不代表源模型实际接线）',illustrative:true},
  {from:'主轴承',to:'主轴组件',kind:'support',label:'支撑主轴'},
  {from:'主机架',to:'主轴承',kind:'support',label:'承载轴承'},
  {from:'主机架',to:'齿轮箱',kind:'support',label:'支撑齿轮箱'},
  {from:'主机架',to:'发电机',kind:'support',label:'支撑发电机'},
  {from:'主机架',to:'辅助变压器',kind:'support',label:'后机架承载辅助变压器底脚'},
  {from:'主机架',to:'液压系统',kind:'support',label:'后机架经液压站安装架承载'},
  {from:'高速轴制动器',to:'高速轴联轴器',kind:'service',label:'制动高速轴（联轴器所在轴系）'},
  {from:'液压系统',to:'高速轴制动器',kind:'service',label:'制动执行关联'},
  {from:'偏航系统',to:'主机架',kind:'service',label:'调整机舱朝向'},
  {from:'机舱外壳',to:'齿轮箱',kind:'protection',label:'包覆防护'},
  {from:'机舱外壳',to:'发电机',kind:'protection',label:'包覆防护'},
  {from:'机舱外壳',to:'辅助变压器',kind:'protection',label:'机舱内设备防护'},
  {from:'机舱外壳',to:'液压系统',kind:'protection',label:'防护液压站主体'},
];

export function equipmentContext(selected:string,available:Set<string>){
  const edges=EQUIPMENT_RELATIONS.filter(e=>available.has(e.from)&&available.has(e.to));
  const power=edges.filter(e=>e.kind==='mechanical'||e.kind==='electrical');
  const walk=(direction:'upstream'|'downstream',graph:EquipmentRelation[])=>{
    const found=new Map<string,number>(),paths=new Map<string,EquipmentRelation[]>(),queue:[string,number][]=[[selected,0]];
    while(queue.length){const [label,depth]=queue.shift()!;
      for(const edge of graph){
        const match=direction==='upstream'?edge.to===label:edge.from===label;
        if(!match)continue;const next=direction==='upstream'?edge.from:edge.to;
        if(next===selected||found.has(next))continue;
        found.set(next,depth+1);
        const previous=paths.get(label)??[];
        paths.set(next,direction==='upstream'?[edge,...previous]:[...previous,edge]);
        queue.push([next,depth+1]);
      }
    }
    return {steps:found,paths};
  };
  const upstreamWalk=walk('upstream',power),downstreamWalk=walk('downstream',power);
  const upstream=upstreamWalk.steps,downstream=downstreamWalk.steps;
  const related:RelatedPart[]=edges.filter(e=>e.kind!=='mechanical'&&e.kind!=='electrical'&&(e.from===selected||e.to===selected))
    .map(e=>({label:e.from===selected?e.to:e.from,description:e.label,kind:e.kind,
      from:e.from,to:e.to,direction:e.to===selected?'incoming' as const:'outgoing' as const,distance:1,path:[e]}));
  // Trace only support edges. Sharing a frame does not make two machines support
  // each other, and transmitting torque or providing a service is not support.
  const support=edges.filter(e=>e.kind==='support');
  for(const direction of ['upstream','downstream'] as const){
    for(const [label,path] of walk(direction,support).paths){
      if(path.length===1)continue;
      related.push({label,kind:'support',from:path[0].from,to:path[path.length-1].to,
        direction:direction==='upstream'?'incoming':'outgoing',distance:path.length,path,
        description:`经${path.slice(0,-1).map(e=>e.to).join('、')}间接支撑`});
    }
  }
  const roles=new Map<string,RelationRole>([[selected,'current']]);
  upstream.forEach((_,label)=>roles.set(label,'upstream'));downstream.forEach((_,label)=>roles.set(label,'downstream'));
  related.forEach(({label})=>{if(!roles.has(label))roles.set(label,'related');});
  const emptyDownstream=selected==='辅助变压器'?'后续电路未展示':'无动力下游';
  const supportNote=related.some(r=>r.kind==='support'&&r.direction==='incoming')?null:'装配支承未单列';
  return {upstream,downstream,upstreamPaths:upstreamWalk.paths,downstreamPaths:downstreamWalk.paths,related,roles,emptyDownstream,supportNote};
}
