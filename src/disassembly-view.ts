import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { packRectangles, planPartLayout, smoothStep } from './disassembly-layout';

export type PartPiece={mesh:THREE.Mesh;instanceId?:number};
export type DisassemblySource={id:string;label:string;system:string;cluster:string;internal?:boolean;pieces:PartPiece[]};
type Finish=THREE.Material|THREE.Material[];
type Piece={source:PartPiece;matrix:THREE.Matrix4;full:THREE.BufferGeometry;low:THREE.BufferGeometry;rootFinish:Finish;solidFinish:Finish};
type Entry={id:string;label:string;system:string;cluster:string;internal:boolean;pieces:Piece[];bounds:THREE.Box3;visible:boolean;number:number};
type Unit={id:string;label:string;members:Entry[];bounds:THREE.Box3;center:THREE.Vector3;offset:THREE.Vector3;tile:THREE.Vector3;tileScale:number;position:THREE.Vector3;scale:number;fromPosition:THREE.Vector3;fromScale:number;transform:THREE.Matrix4};
type Batch={mesh:THREE.InstancedMesh;members:{entry:Entry;piece:Piece}[];full:THREE.BufferGeometry;low:THREE.BufferGeometry;owner:Unit|null;visibleMembers:{index:number;piece:Piece;unit:Unit}[]};
type Options={renderer:THREE.WebGLRenderer;environment:THREE.Texture|null;canvas:HTMLCanvasElement;page:HTMLElement;axis:THREE.Vector3;span:number;majorSystems:string[];camera:()=>THREE.PerspectiveCamera;target:()=>THREE.Vector3;material:(mesh:THREE.Mesh)=>Finish;geometry:(mesh:THREE.Mesh,detailed:boolean)=>THREE.BufferGeometry;interactionReady:()=>boolean;close:()=>void};

/** 原始透视相机 + 总成 / 子总成 / 零件的逐级展示，源装配树保持只读。 */
export class DisassemblyView{
  active=false;
  private options:Options;
  private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera();
  private referenceCamera=new THREE.PerspectiveCamera();
  private referenceTarget=new THREE.Vector3();
  private hubAnchor=new THREE.Vector3();
  private controls:OrbitControls;
  private entries:Entry[]=[];
  private units:Unit[]=[];
  private batches:Batch[]=[];
  private activeBatches:Batch[]=[];
  private bindingsDirty=true;
  private resultMatrix=new THREE.Matrix4();
  private zeroMatrix=new THREE.Matrix4().makeScale(0,0,0);
  private targetPosition=new THREE.Vector3();
  private uiState='';
  private labelFrame:{top:number;bottom:number}|null=null;
  private detailAt=0;
  private lowDetailReady=false;
  private materials=new Map<string,THREE.Material>();
  private scope:HTMLSelectElement;
  private search:HTMLInputElement;
  private slider:HTMLInputElement;
  private labels:HTMLElement;
  private labelElements:HTMLButtonElement[]=[];
  private system='';
  private cluster:string|null=null;
  private progress=0;
  private mode:'explode'|'flat'='explode';
  private animation:{from:number;to:number;elapsed:number;duration:number;blend:boolean}|null=null;
  private selected:Unit|null=null;
  private hovered:Unit|null=null;
  private lastHoverTime=0;
  private inspectionRestore:{camera:THREE.PerspectiveCamera;target:THREE.Vector3;listHidden:boolean;width:number;height:number}|null=null;
  private inspectionNavigation:'rotate'|'pan'='rotate';
  private box=new THREE.Box3Helper(new THREE.Box3(),0xe4be79);
  private abort=new AbortController();
  private pointer:{x:number;y:number;id:number}|null=null;
  private dirty=true;
  private dragging=false;
  private width=0;
  private height=0;
  private initialized=false;
  private listPage=0;
  private lastDrawCalls=0;
  private lastTriangles=0;

  constructor(options:Options){
    this.options=options;
    const find=<T extends HTMLElement>(id:string)=>options.page.querySelector<T>('#'+id)!;
    this.scope=find('disassembly-scope');this.search=find('disassembly-search');this.slider=find('disassembly-progress');this.labels=find('disassembly-labels');
    this.scene.background=new THREE.Color(0x020c13);this.scene.environment=options.environment;this.scene.environmentIntensity=.88;
    this.scene.add(new THREE.HemisphereLight(0xf3f6f5,0x24303a,1.2));
    for(const [color,intensity,position]of[[0xfffdf8,2.5,[7,11,8]],[0xc6dcdf,1.42,[-9,6,-8]],[0x9ebfc6,.38,[3,-4,7]]] as const){const light=new THREE.DirectionalLight(color,intensity);light.position.set(position[0],position[1],position[2]);this.scene.add(light);}
    this.box.visible=false;this.scene.add(this.box);
    this.controls=new OrbitControls(this.camera,options.canvas);this.controls.enabled=false;this.controls.enableDamping=false;
    this.controls.screenSpacePanning=true;this.controls.minDistance=.001;this.controls.maxDistance=2000;this.controls.mouseButtons.RIGHT=null;
    this.controls.addEventListener('change',()=>{this.dirty=true;});
    this.controls.addEventListener('start',()=>{this.dragging=true;this.hovered=null;this.dirty=true;});
    this.controls.addEventListener('end',()=>{this.dragging=false;this.detailAt=performance.now()+180;this.dirty=true;});
    const signal=this.abort.signal;
    find('disassembly-close').addEventListener('click',options.close,{signal});
    find('disassembly-back').addEventListener('click',()=>this.back(),{signal});
    find('disassembly-fit').addEventListener('click',()=>this.resetView(),{signal});
    find('disassembly-assembled').addEventListener('click',()=>this.animateTo(0),{signal});
    find('disassembly-exploded').addEventListener('click',()=>this.changeMode('explode'),{signal});
    find('disassembly-flat').addEventListener('click',()=>this.changeMode('flat'),{signal});
    find('disassembly-play').addEventListener('click',()=>{if(this.animation){this.animation=null;this.updateUi();}else{if(this.progress===1)this.applyProgress(0);this.animateTo(1);}},{signal});
    find('disassembly-list-toggle').addEventListener('click',()=>this.toggleList(),{signal});
    find('disassembly-list-close').addEventListener('click',()=>this.toggleList(false),{signal});
    find('disassembly-list-prev').addEventListener('click',()=>{this.listPage--;this.renderList();},{signal});
    find('disassembly-list-next').addEventListener('click',()=>{this.listPage++;this.renderList();},{signal});
    find('disassembly-focus').addEventListener('click',()=>{if(this.selected)this.fitBounds(this.currentBounds(this.selected));},{signal});
    find('disassembly-inspect-rotate').addEventListener('click',()=>this.setInspectionNavigation('rotate'),{signal});
    find('disassembly-inspect-pan').addEventListener('click',()=>this.setInspectionNavigation('pan'),{signal});
    find('disassembly-inspect-clear').addEventListener('click',()=>this.clearSelection(),{signal});
    this.scope.addEventListener('change',()=>this.enterSystem(this.scope.value),{signal});
    this.search.addEventListener('input',()=>{this.animation=null;this.buildUnits();this.applyProgress(1);this.fitCurrent();},{signal});
    this.slider.addEventListener('input',()=>{this.clearSelection();this.animation=null;this.applyProgress(Number(this.slider.value)/100);},{signal});
    options.canvas.addEventListener('pointerdown',event=>{if(this.active&&event.button===0)this.pointer={x:event.clientX,y:event.clientY,id:event.pointerId};},{signal});
    options.canvas.addEventListener('pointermove',event=>{if(this.pointer&&Math.hypot(event.clientX-this.pointer.x,event.clientY-this.pointer.y)>5)this.pointer=null;if(event.pointerType!=='touch'&&event.buttons===0)this.hover(event.clientX,event.clientY);},{signal});
    options.canvas.addEventListener('pointerleave',()=>{if(this.hovered){this.hovered=null;this.dirty=true;}},{signal});
    options.canvas.addEventListener('pointercancel',()=>{this.pointer=null;},{signal});
    options.canvas.addEventListener('pointerup',event=>{const p=this.pointer;this.pointer=null;if(this.active&&p?.id===event.pointerId&&Math.hypot(event.clientX-p.x,event.clientY-p.y)<5)this.pick(event.clientX,event.clientY);},{signal});
  }
  private finish(source:THREE.Material,kind:'root'|'solid'):THREE.Material{
    const key=source.uuid+'/'+kind;const existing=this.materials.get(key);if(existing)return existing;
    const material=source.clone();material.clippingPlanes=null;
    if(kind==='solid'){
      material.opacity=1;material.transparent=false;material.depthWrite=true;
      if((material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial)(material as THREE.MeshPhysicalMaterial).transmission=0;
      const shaded=material as THREE.MeshStandardMaterial,color=shaded.color;
      if(color&&color.r*.2126+color.g*.7152+color.b*.0722<.12){
        color.lerp(new THREE.Color(0xa7b6c2),.65);
        if(shaded.isMeshStandardMaterial){shaded.roughness=Math.max(.35,shaded.roughness);shaded.metalness=Math.min(.82,shaded.metalness);shaded.emissive.copy(color).multiplyScalar(.10);shaded.emissiveIntensity=1;}
      }
    }
    this.materials.set(key,material);return material;
  }
  async initialize(sources:DisassemblySource[]):Promise<void>{
    if(this.initialized)return;
    for(let index=0;index<sources.length;index++){
      const source=sources[index],pieces:Piece[]=[];
      for(const part of source.pieces){
        const full=this.options.geometry(part.mesh,true),low=this.options.geometry(part.mesh,false);if(!full.attributes.position?.count)continue;
        if(!full.boundingBox)full.computeBoundingBox();
        const original=this.options.material(part.mesh),materials=Array.isArray(original)?original:[original];
        const finish=(kind:'root'|'solid')=>{const list=materials.map(material=>this.finish(material,kind));return Array.isArray(original)?list:list[0];};
        pieces.push({source:part,matrix:new THREE.Matrix4(),full,low,rootFinish:finish('root'),solidFinish:finish('solid')});
      }
      if(pieces.length)this.entries.push({id:source.id,label:source.label,system:source.system,cluster:source.cluster,internal:!!source.internal,pieces,bounds:new THREE.Box3(),visible:false,number:this.entries.length+1});
      if(index%400===399)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    }
    const groups=new Map<string,{members:Batch['members'];piece:Piece}>();
    this.entries.forEach((entry,index)=>entry.pieces.forEach(piece=>{
      const materials=Array.isArray(piece.rootFinish)?piece.rootFinish:[piece.rootFinish];
      const key=[piece.full.uuid,materials.map(m=>m.uuid).join(','),entry.system,entry.cluster,entry.internal,Math.floor(index/128)].join('/');
      const group=groups.get(key)??{members:[],piece};group.members.push({entry,piece});groups.set(key,group);
    }));
    for(const {members,piece}of groups.values()){const mesh=new THREE.InstancedMesh(piece.low,piece.rootFinish,members.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;this.scene.add(mesh);this.batches.push({mesh,members,full:piece.full,low:piece.low,owner:null,visibleMembers:[]});}
    this.scope.replaceChildren(new Option('主要总成',''));
    for(const system of [...new Set(this.entries.map(e=>e.system))])this.scope.append(new Option(system,system));
    this.initialized=true;
    this.refreshInteractionGeometry();
  }
  private refreshInteractionGeometry():void{
    // 用户可能在轻量模型下载完成前进入分解页，加载完成后补齐缓存。
    if(this.lowDetailReady||!this.options.interactionReady())return;
    for(const entry of this.entries)for(const piece of entry.pieces)piece.low=this.options.geometry(piece.source.mesh,false);
    for(const batch of this.batches)batch.low=batch.members[0].piece.low;
    this.lowDetailReady=true;this.dirty=true;
  }
  private refreshSnapshot():void{
    const instance=new THREE.Matrix4();
    for(const entry of this.entries){entry.bounds.makeEmpty();for(const piece of entry.pieces){
      const {mesh,instanceId}=piece.source;mesh.updateWorldMatrix(true,false);piece.matrix.copy(mesh.matrixWorld);
      if(instanceId!==undefined){(mesh as THREE.InstancedMesh).getMatrixAt(instanceId,instance);piece.matrix.multiply(instance);}
      entry.bounds.union(piece.full.boundingBox!.clone().applyMatrix4(piece.matrix));
    }}
    const hubBounds=new THREE.Box3();this.entries.filter(e=>e.system==='轮毂总成'&&!e.internal).forEach(e=>hubBounds.union(e.bounds));if(!hubBounds.isEmpty())hubBounds.getCenter(this.hubAnchor);
  }
  open():void{
    this.active=true;this.options.page.hidden=false;this.referenceCamera.copy(this.options.camera());this.referenceTarget.copy(this.options.target());
    this.refreshSnapshot();this.system='';this.cluster=null;this.scope.value='';this.search.value='';this.mode='explode';this.selected=null;this.bindingsDirty=true;this.detailAt=0;
    this.options.page.querySelector<HTMLElement>('#disassembly-list')!.hidden=true;
    this.width=this.options.canvas.clientWidth;this.height=this.options.canvas.clientHeight;this.options.renderer.setPixelRatio(Math.min(devicePixelRatio,1));this.options.renderer.setSize(this.width,this.height,false);this.progress=0;this.resetOverviewCamera();this.buildUnits();this.applyProgress(0);this.animateTo(1);
  }
  close():void{this.active=false;this.animation=null;this.controls.enabled=false;this.pointer=null;this.options.page.hidden=true;}
  private rootOffset(system:string):THREE.Vector3{
    const axis=this.options.axis.clone().normalize(),up=new THREE.Vector3(0,1,0),side=new THREE.Vector3().crossVectors(axis,up).normalize(),unit=this.options.span*.042;
    const vectors:Record<string,[number,number,number]>={'叶片':[-1.5,0,0],'轮毂总成':[-1,0,0],'主轴组件':[-.4,0,0],'主轴承':[0,.8,0],'齿轮箱':[0,1,0],'高速轴制动器':[0,0,1.2],'高速轴联轴器':[.3,0,1.4],'发电机':[1.4,.8,0],'主机架':[0,-1,0],'液压系统':[0,0,-1.1],'辅助变压器':[1.2,0,-1],'偏航系统':[0,-1.6,0],'机舱外壳':[0,2.2,0]};
    const v=vectors[system]??[0,0,0];return axis.multiplyScalar(v[0]*unit).addScaledVector(up,v[1]*unit).addScaledVector(side,v[2]*unit);
  }
  private buildUnits():void{
    this.selected=null;this.hovered=null;this.inspectionRestore=null;this.bindingsDirty=true;this.labelFrame=null;const query=this.search.value.trim(),groups=new Map<string,Entry[]>();
    for(const entry of this.entries){
      entry.visible=this.system?entry.system===this.system&&(this.cluster===null||entry.cluster===this.cluster):!entry.internal&&this.options.majorSystems.includes(entry.system);
      if(query)entry.visible&&=(this.system?entry.label+' '+entry.cluster:entry.system).includes(query);
      if(!entry.visible)continue;
      if(!this.system&&!this.options.majorSystems.includes(entry.system))continue;
      const key=!this.system?entry.system:this.cluster===null?entry.cluster:entry.id;
      const members=groups.get(key)??[];members.push(entry);groups.set(key,members);
    }
    this.units=[...groups].map(([id,members])=>{
      const bounds=new THREE.Box3();members.forEach(entry=>bounds.union(entry.bounds));
      const center=bounds.getCenter(new THREE.Vector3());
      return {id,label:!this.system?id:this.cluster===null?id:members[0].label,members,bounds,center,offset:new THREE.Vector3(),tile:new THREE.Vector3(),tileScale:1,position:center.clone(),scale:1,fromPosition:center.clone(),fromScale:1,transform:new THREE.Matrix4()};
    });
    const all=new THREE.Box3();this.units.forEach(unit=>all.union(unit.bounds));
    const center=all.getCenter(new THREE.Vector3()),size=all.getSize(new THREE.Vector3()),span=Math.max(size.length(),.001);
    const sorted=[...this.units].sort((a,b)=>a.center.dot(this.options.axis)-b.center.dot(this.options.axis));
    for(const unit of this.units){
      if(!this.system)unit.offset.copy(this.rootOffset(unit.id));
      else{
        const local=unit.center.clone().sub(center),rank=sorted.indexOf(unit),t=sorted.length===1?0:(rank/(sorted.length-1)-.5);
        unit.offset.copy(local).multiplyScalar(.38).addScaledVector(this.options.axis,span*.28*t);
        if(/外壳|箱体|机座/.test(unit.label))unit.offset.y+=span*.16;
        else if(/端盖|定子/.test(unit.label))unit.offset.y+=span*.07;
        if(this.system==='叶片')unit.offset.clampLength(0,this.options.span*.05);
      }
    }
    if(!this.system)this.arrangeMainAssemblies();
    const header=this.options.page.querySelector<HTMLElement>('.disassembly-header')!.getBoundingClientRect(),footer=this.options.page.querySelector<HTMLElement>('.disassembly-timeline')!.getBoundingClientRect();
    const aspect=Math.max(100,this.width-64)/Math.max(80,footer.top-header.bottom-60);
    const layout=planPartLayout(this.units.map(u=>({id:u.id,system:this.system||'主要总成',size:u.bounds.getSize(new THREE.Vector3()).length()})),aspect);
    for(const unit of this.units){const tile=layout.positions.get(unit.id)!;unit.tile.set(tile.x,tile.y,0);unit.tileScale=tile.scale;}
    this.labels.replaceChildren();this.labelElements=this.units.map(unit=>{
      const button=document.createElement('button');button.type='button';button.textContent=unit.label;button.title=this.semanticText(unit)+(this.canExpand(unit)?'；点击单独展开':'；点击单独观察');button.addEventListener('click',()=>this.enterUnit(unit));this.labels.append(button);return button;
    });
    this.spaceUnits();if(!this.system)this.resetOverviewCamera();this.listPage=0;this.renderList();this.applyProgress(this.progress);
    this.options.page.querySelector<HTMLElement>('#disassembly-empty')!.hidden=this.units.length!==0;
  }
  private enterSystem(system:string):void{
    if(system&&this.entries.filter(e=>e.system===system).length<=1){
      if(this.system){this.system='';this.cluster=null;this.search.value='';this.mode='explode';this.animation=null;this.progress=1;this.buildUnits();this.resetOverviewCamera();}
      this.scope.value='';const unit=this.units.find(u=>u.id===system);if(unit)this.inspectUnit(unit);return;
    }
    this.system=system;this.cluster=null;this.scope.value=system;this.search.value='';this.mode='explode';this.animation=null;this.progress=0;this.resetOverviewCamera();
    this.buildUnits();
    if(this.system&&this.units.length===1&&this.units[0].members.length>1){this.cluster=this.units[0].id;this.buildUnits();}
    this.fitCurrent();this.animateTo(1);
  }
  private enterUnit(unit:Unit):void{
    if(!this.canExpand(unit)){this.inspectUnit(unit);return;}
    if(!this.system){this.enterSystem(unit.id);return;}
    if(this.cluster===null&&unit.members.length>1){this.cluster=unit.id;this.search.value='';this.mode='explode';this.animation=null;this.progress=0;this.buildUnits();this.fitCurrent();this.animateTo(1);return;}
    this.selected=unit;this.updateSelection();this.fitBounds(this.currentBounds(unit));
  }
  private canExpand(unit:Unit):boolean{
    if(this.cluster!==null)return false;
    const members=this.system?unit.members:this.entries.filter(entry=>entry.system===unit.id);
    return members.length>1;
  }
  private back():void{
    if(this.cluster!==null){this.cluster=null;this.animation=null;this.progress=0;this.mode='explode';this.buildUnits();this.fitCurrent();this.animateTo(1);}
    else this.enterSystem('');
  }
  private changeMode(mode:'explode'|'flat'):void{
    this.clearSelection();
    if(mode==='flat'&&!this.system)return;
    const blend=mode!==this.mode;this.mode=mode;
    if(blend){this.units.forEach(u=>{u.fromPosition.copy(u.position);u.fromScale=u.scale;});this.animateTo(1,blend);}
    else this.animateTo(1);
    if(this.system)this.fitCurrent();
  }
  private animateTo(target:number,blend=false):void{
    if(this.selected)this.clearSelection();
    if(matchMedia('(prefers-reduced-motion:reduce)').matches){this.animation=null;this.applyProgress(target);return;}
    this.animation={from:this.progress,to:target,elapsed:0,duration:blend?1.7:Math.max(.6,Math.abs(target-this.progress)*2.3),blend};this.controls.enabled=false;this.updateUi();this.dirty=true;
  }
  /** 层级或选择变化时建立绑定；整组移动只更新物体矩阵，不重复上传全部实例。 */
  private refreshBindings():void{
    const owners=new Map<Entry,Unit>();this.units.forEach(unit=>unit.members.forEach(entry=>owners.set(entry,unit)));this.activeBatches=[];
    for(const batch of this.batches){
      batch.visibleMembers=[];
      batch.members.forEach(({entry,piece},index)=>{const unit=owners.get(entry);if(entry.visible&&unit&&(!this.selected||this.selected===unit))batch.visibleMembers.push({index,piece,unit});});
      batch.mesh.visible=batch.visibleMembers.length>0;if(!batch.mesh.visible)continue;
      const first=batch.visibleMembers[0],owner=first.unit;
      batch.owner=batch.visibleMembers.every(member=>member.unit===owner)?owner:null;
      batch.mesh.matrix.identity();batch.mesh.matrixWorldNeedsUpdate=true;
      batch.members.forEach((_,index)=>batch.mesh.setMatrixAt(index,this.zeroMatrix));
      for(const member of batch.visibleMembers)batch.mesh.setMatrixAt(member.index,member.piece.matrix);
      batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.boundingSphere=null;batch.mesh.boundingBox=null;
      batch.mesh.material=this.system?first.piece.solidFinish:first.piece.rootFinish;
      this.activeBatches.push(batch);
    }
    this.bindingsDirty=false;
  }
  private applyProgress(value:number,blend?:number):void{
    this.progress=Math.min(1,Math.max(0,value));const t=smoothStep(this.progress);
    if(this.bindingsDirty)this.refreshBindings();
    for(const unit of this.units){
      const target=this.mode==='flat'?unit.tile:this.targetPosition.copy(unit.center).add(unit.offset),scale=this.mode==='flat'?unit.tileScale:1;
      if(blend!==undefined){unit.position.lerpVectors(unit.fromPosition,target,blend);unit.scale=THREE.MathUtils.lerp(unit.fromScale,scale,blend);}
      else{unit.position.lerpVectors(unit.center,target,t);unit.scale=THREE.MathUtils.lerp(1,scale,t);}
      unit.transform.makeScale(unit.scale,unit.scale,unit.scale);unit.transform.setPosition(this.targetPosition.copy(unit.position).addScaledVector(unit.center,-unit.scale));
    }
    for(const batch of this.activeBatches){
      if(batch.owner){batch.mesh.matrix.copy(batch.owner.transform);batch.mesh.matrixWorldNeedsUpdate=true;}
      else{
        for(const {index,piece,unit}of batch.visibleMembers)batch.mesh.setMatrixAt(index,this.resultMatrix.multiplyMatrices(unit.transform,piece.matrix));
        batch.mesh.instanceMatrix.needsUpdate=true;batch.mesh.boundingSphere=null;batch.mesh.boundingBox=null;
      }
    }
    this.controls.enabled=this.active&&!this.animation;this.controls.enableRotate=this.mode!=='flat';
    this.controls.mouseButtons.LEFT=this.mode==='flat'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;this.controls.touches.ONE=this.mode==='flat'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;this.controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    this.updateUi();this.updateSelection();this.dirty=true;
  }
  private updateUi():void{
    const percentage=String(Math.round(this.progress*100));if(this.slider.value!==percentage)this.slider.value=percentage;
    const output=this.options.page.querySelector<HTMLOutputElement>('#disassembly-progress-value')!;if(output.value!==percentage+'%')output.value=percentage+'%';
    const state=[this.system,this.cluster,this.units.length,this.mode,!!this.selected,!!this.animation,this.progress<.01,this.progress>.98,this.progress===1].join('|');if(state===this.uiState)return;this.uiState=state;this.labelFrame=null;
    const title=this.system?(this.cluster??this.system)+'分解':'主要总成分解';
    this.options.page.querySelector('h1')!.textContent=title;
    this.options.page.querySelector('#disassembly-count')!.textContent=this.units.length+(this.cluster!==null?' 个零件':this.system?' 个部件':' 个总成');
    this.options.page.querySelector<HTMLElement>('#disassembly-back')!.hidden=!this.system;
    this.options.page.querySelector<HTMLElement>('#disassembly-flat')!.hidden=!this.system;
    this.options.page.querySelector('#disassembly-list-toggle')!.textContent=this.system?'部件清单':'总成清单';
    this.options.page.querySelector('#disassembly-stage')!.textContent=this.progress<.01?'装配状态':this.mode==='flat'?'当前平铺':'分级展开';
    this.options.page.querySelector('#disassembly-play')!.textContent=this.animation?'暂停动画':this.progress===1?'重新展开':'继续展开';
    this.options.page.querySelector('#disassembly-hint')!.textContent=this.selected?'点击空白处返回分解':!this.system?'点击总成，聚焦并展开内部':this.units.length>12?'悬停看名称，点击单独观察；清单保留全部语义':this.cluster===null?'点击部件继续展开；上一级返回整机':'点击零件单独观察';
    for(const [id,pressed]of[['assembled',this.progress<.01],['exploded',this.progress>.98&&this.mode==='explode'],['flat',this.progress>.98&&this.mode==='flat']] as const)this.options.page.querySelector('#disassembly-'+id)!.setAttribute('aria-pressed',String(pressed));
  }
  private currentBounds(unit:Unit):THREE.Box3{return unit.bounds.clone().translate(unit.center.clone().negate()).applyMatrix4(new THREE.Matrix4().makeScale(unit.scale,unit.scale,unit.scale)).translate(unit.position);}
  private arrangeMainAssemblies():void{
    const axis=this.options.axis.clone().normalize(),up=new THREE.Vector3(0,1,0),side=new THREE.Vector3().crossVectors(axis,up).normalize(),gap=Math.max(.05,this.options.span*.008);
    const interval=(box:THREE.Box3,direction:THREE.Vector3)=>{const values:number[]=[];for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z])values.push(new THREE.Vector3(x,y,z).dot(direction));return {min:Math.min(...values),max:Math.max(...values)};};
    const find=(name:string)=>this.units.find(unit=>unit.id===name);
    let end:number|null=null;
    for(const name of['轮毂总成','主轴组件','齿轮箱','高速轴联轴器','发电机']){
      const unit=find(name);if(!unit)continue;const range=interval(unit.bounds,axis);const shift:number=end===null?-gap:Math.max(0,end+gap-range.min);
      unit.offset.copy(axis).multiplyScalar(shift);end=range.max+shift;
    }
    const hub=find('轮毂总成'),blades=find('叶片');if(hub&&blades)blades.offset.copy(hub.offset).addScaledVector(axis,-gap);
    const shaft=find('主轴组件'),bearing=find('主轴承');
    if(shaft&&bearing){bearing.offset.copy(shaft.offset);bearing.offset.y+=shaft.bounds.max.y-bearing.bounds.min.y+gap;}
    const coupling=find('高速轴联轴器'),brake=find('高速轴制动器');
    if(coupling&&brake){brake.offset.copy(coupling.offset);brake.offset.y+=coupling.bounds.max.y-brake.bounds.min.y+gap;}
    const frame=find('主机架');
    if(frame){
      const lowest=Math.min(...this.units.filter(unit=>['主轴组件','齿轮箱','发电机'].includes(unit.id)).map(unit=>unit.bounds.min.y+unit.offset.y));
      frame.offset.set(0,Math.min(-gap,lowest-gap-frame.bounds.max.y),0);
      const yaw=find('偏航系统');if(yaw)yaw.offset.set(0,frame.bounds.min.y+frame.offset.y-gap-yaw.bounds.max.y,0);
      for(const name of['液压系统','辅助变压器']){const unit=find(name);if(!unit)continue;const required=interval(frame.bounds,side).max+gap-interval(unit.bounds,side).min;unit.offset.copy(frame.offset).addScaledVector(side,Math.min(this.options.span*.12,Math.max(gap,required)));}
    }
  }
  private spaceUnits():void{
    if(!this.system||this.mode!=='explode'||this.system==='叶片')return;
    this.camera.updateMatrixWorld(true);
    const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion),forward=this.camera.getWorldDirection(new THREE.Vector3());
    const candidates=this.units.filter(unit=>this.system||unit.id!=='叶片');
    for(let pass=0;pass<3;pass++){
      const rectangles=candidates.map(unit=>{
        const box=unit.bounds.clone().translate(unit.offset);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).project(this.camera),sx=(p.x*.5+.5)*this.width,sy=(-p.y*.5+.5)*this.height;minX=Math.min(minX,sx);maxX=Math.max(maxX,sx);minY=Math.min(minY,sy);maxY=Math.max(maxY,sy);}
        return {id:unit.id,x:(minX+maxX)/2,y:(minY+maxY)/2,width:Math.max(1,maxX-minX),height:Math.max(1,maxY-minY)};
      }).filter(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width<12000&&r.height<12000);
      const header=this.options.page.querySelector<HTMLElement>('.disassembly-header')!.getBoundingClientRect(),footer=this.options.page.querySelector<HTMLElement>('.disassembly-timeline')!.getBoundingClientRect();
      const positions=packRectangles(rectangles,6,!this.system?{left:16,right:this.width-16,top:header.bottom+16,bottom:footer.top-18}:undefined);
      for(const rect of rectangles){const unit=candidates.find(u=>u.id===rect.id)!,next=positions.get(rect.id)!,depth=unit.center.clone().add(unit.offset).sub(this.camera.position).dot(forward),scale=2*Math.max(.01,depth)*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))/this.height;
        unit.offset.addScaledVector(right,(next.x-rect.x)*scale).addScaledVector(up,-(next.y-rect.y)*scale);
      }
    }
  }
  private resetOverviewCamera():void{
    this.camera.copy(this.referenceCamera);this.camera.aspect=this.width/Math.max(1,this.height);this.camera.updateProjectionMatrix();this.controls.target.copy(this.referenceTarget);this.controls.update();this.camera.updateMatrixWorld(true);
    let lift=Math.min(56,this.height*.065);
    const yaw=this.units.find(unit=>unit.id==='偏航系统');
    if(!this.system&&yaw){
      const box=yaw.bounds.clone().translate(yaw.offset),footer=this.options.page.querySelector<HTMLElement>('.disassembly-timeline')!.getBoundingClientRect(),rect=this.options.canvas.getBoundingClientRect();let bottom=-Infinity;
      for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){const p=new THREE.Vector3(x,y,z).project(this.camera);bottom=Math.max(bottom,(-p.y*.5+.5)*this.height);}
      lift=Math.max(lift,bottom-(footer.top-rect.top-18));
    }
    const view=this.referenceCamera.view;
    if(view?.enabled)this.camera.setViewOffset(view.fullWidth,view.fullHeight,view.offsetX,view.offsetY+lift*view.height/Math.max(this.height,1),view.width,view.height);
    else this.camera.setViewOffset(this.width,this.height,0,lift,this.width,this.height);
    this.dirty=true;
  }
  private resetView():void{
    // 复位只操作相机，不能再次排布或改变展开进度。
    if(this.selected){this.fitBounds(this.currentBounds(this.selected));this.setInspectionNavigation('rotate');}
    else if(!this.system||this.system==='叶片')this.resetOverviewCamera();
    else{const bounds=new THREE.Box3();for(const unit of this.units)bounds.union(this.currentBounds(unit));this.fitBounds(bounds);}
    this.controls.enabled=!this.animation;this.hovered=null;this.labelFrame=null;this.dirty=true;
  }
  private fitCurrent():void{
    if(this.selected){this.fitBounds(this.currentBounds(this.selected));return;}
    if(!this.system||this.system==='叶片'){this.resetOverviewCamera();return;}
    const bounds=new THREE.Box3();
    for(const unit of this.units){
      if(this.mode==='flat')bounds.union(unit.bounds.clone().translate(unit.center.clone().negate()).applyMatrix4(new THREE.Matrix4().makeScale(unit.tileScale,unit.tileScale,unit.tileScale)).translate(unit.tile));
      else bounds.union(unit.bounds).union(unit.bounds.clone().translate(unit.offset));
    }
    this.fitBounds(bounds);
    if(this.mode==='explode'){this.spaceUnits();const expanded=new THREE.Box3();for(const unit of this.units)expanded.union(unit.bounds).union(unit.bounds.clone().translate(unit.offset));this.fitBounds(expanded);this.applyProgress(this.progress);}
  }
  private fitBounds(bounds:THREE.Box3):void{
    if(bounds.isEmpty())return;
    const header=this.options.page.querySelector<HTMLElement>('.disassembly-header')!.getBoundingClientRect(),footer=this.options.page.querySelector<HTMLElement>('.disassembly-timeline')!.getBoundingClientRect(),rect=this.options.canvas.getBoundingClientRect();
    let top=header.bottom-rect.top+22,bottom=footer.top-rect.top-22,right=this.width-24;
    if(this.selected){const detail=this.options.page.querySelector<HTMLElement>('#disassembly-selection')!.getBoundingClientRect();if(detail.height)bottom=Math.min(bottom,detail.top-rect.top-14);}
    const list=this.options.page.querySelector<HTMLElement>('#disassembly-list')!,lr=list.getBoundingClientRect();
    if(!list.hidden){if(lr.left>this.width*.4)right=lr.left-rect.left-15;else bottom=Math.min(bottom,lr.top-rect.top-12);}
    const frameWidth=Math.max(100,right-24),frameHeight=Math.max(80,bottom-top),center=bounds.getCenter(new THREE.Vector3());
    const direction=this.mode==='flat'?new THREE.Vector3(0,0,1):this.referenceCamera.position.clone().sub(this.referenceTarget).normalize();
    const horizontal=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize(),vertical=new THREE.Vector3().crossVectors(direction,horizontal);
    const tan=Math.tan(THREE.MathUtils.degToRad(this.referenceCamera.fov/2)),aspect=this.width/this.height;let distance=.01;
    for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]){
      const corner=new THREE.Vector3(x,y,z).sub(center),depth=corner.dot(direction);
      distance=Math.max(distance,Math.abs(corner.dot(horizontal))/(tan*aspect*frameWidth/this.width)+depth,Math.abs(corner.dot(vertical))/(tan*frameHeight/this.height)+depth);
    }
    distance*=1.13;this.camera.fov=this.referenceCamera.fov;this.camera.aspect=aspect;this.camera.clearViewOffset();this.camera.zoom=1;
    this.camera.near=Math.max(1e-5,distance/10000);this.camera.far=Math.max(5000,distance*10);
    this.camera.position.copy(center).addScaledVector(direction,distance);this.controls.target.copy(center);this.camera.up.set(0,1,0);this.camera.lookAt(center);
    this.camera.setViewOffset(this.width,this.height,this.width/2-(24+right)/2,this.height/2-(top+bottom)/2,this.width,this.height);
    this.controls.update();this.camera.updateMatrixWorld(true);this.camera.updateProjectionMatrix();this.dirty=true;
  }
  private pick(x:number,y:number):void{
    if(this.animation)return;
    this.camera.updateMatrixWorld(true);const rect=this.options.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),this.camera);
    const candidates=this.batches.filter(b=>b.mesh.visible&&((Array.isArray(b.mesh.material)?b.mesh.material[0]:b.mesh.material).opacity>=.18));
    const hits=ray.intersectObjects(candidates.map(b=>b.mesh),false);
    for(const hit of hits){if(hit.instanceId===undefined)continue;const entry=candidates.find(b=>b.mesh===hit.object)!.members[hit.instanceId].entry;if(!entry.visible||(this.selected&&!this.selected.members.includes(entry)))continue;const unit=this.units.find(u=>u.members.includes(entry));if(unit){this.enterUnit(unit);return;}}
    this.clearSelection();
  }
  private hover(x:number,y:number):void{
    if(!this.active||this.animation||this.dragging||this.selected||this.units.length<=12||performance.now()-this.lastHoverTime<80)return;
    this.lastHoverTime=performance.now();this.camera.updateMatrixWorld(true);
    const rect=this.options.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),this.camera);
    let nearest:Unit|null=null,distance=Infinity;
    for(const unit of this.units){const hit=ray.ray.intersectBox(this.currentBounds(unit),new THREE.Vector3());if(hit){const d=hit.distanceToSquared(ray.ray.origin);if(d<distance){distance=d;nearest=unit;}}}
    if(nearest!==this.hovered){this.hovered=nearest;this.dirty=true;}
  }
  private semanticText(unit:Unit):string{
    if(unit.label==='制动钳总成')return '高速轴制动器 · 夹持制动盘产生制动力；当前以完整总成提供';
    if(unit.label==='制动盘'||unit.label==='高速制动盘示意')return '高速轴制动器 · 随高速轴转动并与制动钳配合，结构示意';
    const meanings:Record<string,string>={'叶片':'接收风能并带动风轮旋转','轮毂总成':'连接叶片与主轴，传递风轮转矩','主轴组件':'把风轮转矩传递至齿轮箱','主轴承':'支撑主轴并承受风轮载荷','齿轮箱':'在传动链中进行转速与转矩转换','高速轴制动器':'用于高速轴制动','高速轴联轴器':'连接齿轮箱输出轴与发电机','发电机':'将机械能转换为电能','主机架':'承载并连接机舱内主要设备','液压系统':'提供液压动力及辅助控制','辅助变压器':'辅助电气系统的电压变换设备','偏航系统':'调整机舱朝向','定子绕组':'参与电磁能量转换的定子导体','定子铁心':'形成定子磁路并支撑绕组','转子总成':'随轴旋转并参与电磁能量转换','轴承组件':'支撑转动部件并减小摩擦','集电环组件':'连接转子绕组与外部电路','电刷组件':'与集电环接触，完成电气连接','端盖组件':'支撑和封闭电机端部结构'};
    const path=this.system?[this.system,this.cluster].filter(Boolean).join(' / '):unit.label;
    return path+' · '+(meanings[unit.label]??(/螺栓|螺钉|螺母|垫圈/.test(unit.label)?'用于部件连接与紧固':this.cluster?this.cluster+'中的独立零件':meanings[this.system]??'装配中的组成部件'));
  }
  private inspectUnit(unit:Unit):void{
    if(this.selected===unit)return;
    if(!this.inspectionRestore)this.inspectionRestore={camera:this.camera.clone(),target:this.controls.target.clone(),listHidden:Boolean(this.options.page.querySelector<HTMLElement>('#disassembly-list')!.hidden),width:this.width,height:this.height};
    this.selected=unit;this.animation=null;this.bindingsDirty=true;this.applyProgress(this.progress);this.fitBounds(this.currentBounds(unit));this.setInspectionNavigation('rotate');
  }
  clearSelection():boolean{
    if(!this.selected)return false;
    this.selected=null;this.bindingsDirty=true;
    const restore=this.inspectionRestore;
    if(restore){this.camera.copy(restore.camera);this.camera.aspect=this.width/Math.max(1,this.height);this.camera.updateProjectionMatrix();this.controls.target.copy(restore.target);this.controls.update();this.inspectionRestore=null;}
    this.applyProgress(this.progress);
    if(restore&&(restore.width!==this.width||restore.height!==this.height||restore.listHidden!==this.options.page.querySelector<HTMLElement>('#disassembly-list')!.hidden))this.fitCurrent();
    return true;
  }
  private setInspectionNavigation(mode:'rotate'|'pan'):void{
    this.inspectionNavigation=mode;this.controls.enabled=true;this.controls.enableRotate=mode==='rotate';this.controls.enablePan=true;
    this.controls.mouseButtons.LEFT=mode==='rotate'?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;this.controls.touches.ONE=mode==='rotate'?THREE.TOUCH.ROTATE:THREE.TOUCH.PAN;
    this.options.page.querySelector('#disassembly-inspect-rotate')!.setAttribute('aria-pressed',String(mode==='rotate'));this.options.page.querySelector('#disassembly-inspect-pan')!.setAttribute('aria-pressed',String(mode==='pan'));this.dirty=true;
  }
  private updateSelection():void{
    const detail=this.options.page.querySelector<HTMLElement>('#disassembly-selection')!;if(detail.hidden===!this.selected&&!this.selected)return;detail.hidden=!this.selected;this.box.visible=!!this.selected;
    if(this.selected){detail.querySelector('strong')!.textContent=this.selected.label;detail.querySelector('small')!.textContent=this.semanticText(this.selected);this.box.box.copy(this.currentBounds(this.selected));}
  }
  private updateLabels():void{
    if(!this.labelFrame)this.labelFrame={top:this.options.page.querySelector<HTMLElement>('.disassembly-header')!.getBoundingClientRect().bottom,bottom:this.options.page.querySelector<HTMLElement>('.disassembly-timeline')!.getBoundingClientRect().top};
    const {top,bottom}=this.labelFrame;
    const occupied:Array<{x:number;y:number;w:number}>=[];
    this.units.forEach((unit,index)=>{
      const element=this.labelElements[index],relevant=this.selected?unit===this.selected:this.units.length<=12||unit===this.hovered;
      if(!relevant){if(!element.hidden)element.hidden=true;return;}
      let p=unit.position.clone().project(this.camera);
      if(!this.system&&unit.id==='叶片')p=this.bladeLabelProjection(unit,top,bottom);
      const px=(p.x*.5+.5)*this.width,py=(-p.y*.5+.5)*this.height;
      const width=Math.min(170,unit.label.length*13+22);let x=Math.min(this.width-width-16,Math.max(16,px+12)),y=py-30;
      let visible=p.z>-1&&p.z<1&&px>0&&px<this.width&&py>top&&py<bottom;
      for(let attempt=0;attempt<8&&visible;attempt++){
        if(y<top+12)y=top+12;
        if(!occupied.some(r=>x<r.x+r.w+8&&x+width+8>r.x&&y<r.y+32&&y+32>r.y))break;
        y+=34;if(y>bottom-40)visible=false;
      }
      element.hidden=!visible;if(visible){element.style.left=x+'px';element.style.top=y+'px';occupied.push({x,y,w:width});}
    });
  }
  private bladeLabelProjection(unit:Unit,top:number,bottom:number):THREE.Vector3{
    const shift=unit.position.clone().sub(unit.center),target=Math.min(bottom-55,this.height*.74);let chosen:THREE.Vector3|null=null,best=Infinity;
    for(const entry of unit.members)for(const fraction of[.05,.075,.1,.125,.15,.2,.3]){
      const p=this.hubAnchor.clone().lerp(entry.bounds.getCenter(new THREE.Vector3()),fraction).add(shift).project(this.camera),x=(p.x*.5+.5)*this.width,y=(-p.y*.5+.5)*this.height;
      if(x<24||x>this.width-90||y<Math.max(top+50,this.height*.5)||y>bottom-35||p.z< -1||p.z>1)continue;
      const score=Math.abs(y-target);if(score<best){best=score;chosen=p;}
    }
    return chosen??new THREE.Vector3(-.55,1-target/this.height*2,0);
  }
  private toggleList(open?:boolean):void{
    const list=this.options.page.querySelector<HTMLElement>('#disassembly-list')!;list.hidden=open===undefined?!list.hidden:!open;
    this.options.page.querySelector('#disassembly-list-toggle')!.setAttribute('aria-expanded',String(!list.hidden));
    if(!list.hidden)this.renderList();if(this.system||this.selected)this.fitCurrent();this.dirty=true;
  }
  private renderList():void{
    const count=Math.max(1,Math.ceil(this.units.length/40));this.listPage=Math.min(count-1,Math.max(0,this.listPage));
    const list=this.options.page.querySelector('#disassembly-list-items')!;list.replaceChildren();
    this.units.slice(this.listPage*40,this.listPage*40+40).forEach((unit,index)=>{
      const button=document.createElement('button');button.type='button';button.dataset.partId=unit.id;
      const number=document.createElement('span'),name=document.createElement('strong'),hint=document.createElement('small');
      number.textContent=String(this.listPage*40+index+1).padStart(2,'0');name.textContent=unit.label;hint.textContent=this.semanticText(unit);button.title=this.canExpand(unit)?'点击单独展开':'点击单独观察';button.append(number,name,hint);button.addEventListener('click',()=>this.enterUnit(unit));list.append(button);
    });
    this.options.page.querySelector('#disassembly-list-page')!.textContent=(this.listPage+1)+' / '+count;
    this.options.page.querySelector<HTMLButtonElement>('#disassembly-list-prev')!.disabled=this.listPage===0;
    this.options.page.querySelector<HTMLButtonElement>('#disassembly-list-next')!.disabled=this.listPage>=count-1;
  }
  render(delta:number):void{
    if(!this.active)return;
    this.refreshInteractionGeometry();
    const width=this.options.canvas.clientWidth,height=this.options.canvas.clientHeight;
    if(width!==this.width||height!==this.height){this.width=width;this.height=height;this.options.renderer.setPixelRatio(Math.min(devicePixelRatio,1));this.options.renderer.setSize(width,height,false);this.buildUnits();this.fitCurrent();}
    if(this.animation){
      const a=this.animation;a.elapsed+=Math.min(delta,.1);const t=Math.min(1,a.elapsed/a.duration);
      this.applyProgress(THREE.MathUtils.lerp(a.from,a.to,smoothStep(t)),a.blend?smoothStep(t):undefined);
      if(t===1){this.animation=null;this.detailAt=performance.now()+180;this.controls.enabled=true;this.updateUi();}
    }
    if(this.detailAt&&performance.now()>=this.detailAt){this.detailAt=0;this.dirty=true;}
    if(!this.dirty)return;
    const full=!this.animation&&!this.dragging&&!this.detailAt;
    for(const batch of this.activeBatches){const geometry=full?batch.full:batch.low;if(batch.mesh.geometry!==geometry){batch.mesh.geometry=geometry;batch.mesh.boundingSphere=null;batch.mesh.boundingBox=null;}}
    this.camera.updateMatrixWorld(true);this.updateLabels();this.options.renderer.setRenderTarget(null);this.options.renderer.autoClear=true;this.options.renderer.render(this.scene,this.camera);
    this.lastDrawCalls=this.options.renderer.info.render.calls;this.lastTriangles=this.options.renderer.info.render.triangles;this.dirty=false;
  }
  diagnostics(){return {active:this.active,total:this.entries.length,visible:this.entries.filter(e=>e.visible).length,level:this.system?this.cluster!==null?'零件':'部件':'主要总成',system:this.system,cluster:this.cluster,mode:this.mode,unitCount:this.units.length,progress:this.progress,animating:!!this.animation,batches:this.batches.length,drawCalls:this.lastDrawCalls,triangles:this.lastTriangles,sourceGeometryClones:0,selected:this.selected?.id??null,inspectionNavigation:this.inspectionNavigation,guidesVisible:false,opaqueDetail:!!this.system&&this.batches.filter(b=>b.mesh.visible).every(b=>(Array.isArray(b.mesh.material)?b.mesh.material:[b.mesh.material]).every(m=>!m.transparent&&m.opacity===1)),cameraWorld:this.camera.matrixWorld.toArray(),cameraProjection:this.camera.projectionMatrix.toArray(),units:this.units.map(u=>({id:u.id,label:u.label,semantic:this.semanticText(u),members:u.members.length,canExpand:this.canExpand(u),center:u.center.toArray(),position:u.position.toArray(),size:u.bounds.getSize(new THREE.Vector3()).multiplyScalar(u.scale).toArray()}))};}
  dispose():void{this.close();this.abort.abort();this.controls.dispose();this.batches.forEach(b=>b.mesh.dispose());this.materials.forEach(m=>m.dispose());this.box.geometry.dispose();(this.box.material as THREE.Material).dispose();this.scene.clear();}
}
