import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

type Drawable = THREE.Mesh | THREE.LineSegments;
type Binding = { source: Drawable; proxy: Drawable };
type Batch = { root: THREE.Object3D; proxy: THREE.Mesh; members: Binding[]; material: THREE.Material; geometries: THREE.BufferGeometry[] };

/** A render-only flat list. Source nodes, picking identities, geometry and
 * materials stay in the original hierarchy. Batches retain every triangle. */
export class MotionRenderer {
  private scene = new THREE.Scene();
  private bindings: Binding[] = [];
  private batches: Batch[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private indexed=new Map<THREE.BufferGeometry,THREE.BufferGeometry>();
  private lights:THREE.Object3D[]=[];
  private bindingsDirty=true;
  private syncCount=0;
  private activeDrawables=0;

  private renderGeometry(source:THREE.BufferGeometry):THREE.BufferGeometry{
    if(source.index||!this.indexGeometry)return source;
    let geometry=this.indexed.get(source);
    if(!geometry){geometry=mergeVertices(source,1e-8);this.indexed.set(source,geometry);this.geometries.push(geometry);}
    return geometry;
  }

  constructor(private sourceScene: THREE.Scene, private layer: number, rigidRoots: THREE.Object3D[], private additionalLayers:number[]=[],private indexGeometry=true) {
    sourceScene.updateMatrixWorld(true);
    const bySource = new Map<THREE.Object3D, Binding>();
    sourceScene.traverse(object => {
      if ((object as THREE.Light).isLight) {
        const light = object.clone(false);light.matrixAutoUpdate=false;light.matrixWorldAutoUpdate=false;light.matrixWorld=object.matrixWorld;
        this.lights.push(light);this.scene.add(light);return;
      }
      const source=object as THREE.Mesh;
      if(!source.isMesh && !(object as THREE.LineSegments).isLineSegments)return;
      if(!this.inLayer(source))return;
      let proxy:Drawable;
      if((source as THREE.InstancedMesh).isInstancedMesh){
        const original=source as THREE.InstancedMesh;
        const instance=new THREE.InstancedMesh(original.geometry,original.material,original.count);
        instance.instanceMatrix=original.instanceMatrix;instance.instanceColor=original.instanceColor;
        instance.boundingBox=original.boundingBox;instance.boundingSphere=original.boundingSphere;
        proxy=instance;
      }else proxy=source.isMesh?new THREE.Mesh(source.geometry,source.material):new THREE.LineSegments(source.geometry,source.material);
      proxy.name=source.name;proxy.matrixAutoUpdate=false;proxy.matrixWorldAutoUpdate=false;proxy.matrixWorld=source.matrixWorld;
      proxy.layers.set(layer);proxy.frustumCulled=source.frustumCulled;
      this.scene.add(proxy);const binding={source,proxy};this.bindings.push(binding);bySource.set(source,binding);
    });
    const roots=new Set(rigidRoots);
    for(const root of rigidRoots){
      const groups=new Map<THREE.Material,Binding[]>();
      const visit=(node:THREE.Object3D)=>{
        if(node!==root&&roots.has(node))return;
        const mesh=node as THREE.Mesh,material=mesh.material as THREE.Material,binding=bySource.get(node);
        // Position-dependent custom shaders and independently animated instances
        // keep their own draws. Ordinary rigid metal parts may share one draw.
        if(binding&&mesh.isMesh&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&mesh.visible&&!Array.isArray(mesh.material)
          &&!material.transparent&&material.onBeforeCompile===THREE.Material.prototype.onBeforeCompile
          &&mesh.geometry.drawRange.start===0&&!Number.isFinite(mesh.geometry.drawRange.count)){
          const group=groups.get(material)??[];group.push(binding);groups.set(material,group);
        }
        node.children.forEach(visit);
      };visit(root);
      for(const [material,members]of groups){
        if(members.length<2||members.some(b=>b.source.renderOrder!==members[0].source.renderOrder))continue;
        const inverse=root.matrixWorld.clone().invert(),pieces:THREE.BufferGeometry[]=[];
        let valid=true;
        for(const member of members){
          const transform=inverse.clone().multiply(member.source.matrixWorld);
          if(transform.determinant()<=0){valid=false;break;}
          const geometry=member.source.geometry.index?member.source.geometry.toNonIndexed():member.source.geometry.clone();
          geometry.applyMatrix4(transform);geometry.clearGroups();pieces.push(geometry);
        }
        const attributes=pieces[0]?Object.keys(pieces[0].attributes).sort().join(','):'';
        if(pieces.some(g=>Object.keys(g.attributes).sort().join(',')!==attributes))valid=false;
        const merged=valid?mergeGeometries(pieces,false):null;pieces.forEach(g=>g.dispose());
        if(!merged)continue;
        const geometry=mergeVertices(merged,1e-7);merged.dispose();geometry.computeBoundingBox();geometry.computeBoundingSphere();
        const proxy=new THREE.Mesh(geometry,material);proxy.name=`rigid-render-batch:${root.name}`;
        proxy.matrixAutoUpdate=false;proxy.matrixWorldAutoUpdate=false;proxy.matrixWorld=root.matrixWorld;proxy.layers.set(layer);
        this.scene.add(proxy);this.geometries.push(geometry);
        this.batches.push({root,proxy,members,material,geometries:members.map(b=>b.source.geometry)});
      }
    }
    this.scene.matrixWorldAutoUpdate=false;
  }

  private inLayer(object:THREE.Object3D):boolean{
    return object.layers.isEnabled(this.layer)||this.additionalLayers.some(layer=>object.layers.isEnabled(layer));
  }
  private visible(object:THREE.Object3D):boolean{
    for(let node:THREE.Object3D|null=object;node;node=node.parent)if(!node.visible)return false;
    return this.inLayer(object);
  }

  invalidateBindings():void{this.bindingsDirty=true;}

  private syncBindings():void{
    for(const {source,proxy}of this.bindings){
      proxy.visible=this.visible(source);proxy.geometry=source.geometry;proxy.material=source.material;proxy.renderOrder=source.renderOrder;
      proxy.layers.mask=source.layers.mask;
    }
    for(const batch of this.batches){
      const eligible=batch.members.every((b,i)=>b.proxy.visible&&b.source.material===batch.material&&b.source.geometry===batch.geometries[i]);
      batch.proxy.visible=eligible;
      if(eligible){batch.proxy.renderOrder=batch.members[0].source.renderOrder;batch.members.forEach(b=>b.proxy.visible=false);}
    }
    // World matrices and instance buffers stay shared with their source objects.
    // Only visibility/material/LOD changes need to rebuild the draw list.
    this.scene.clear();this.lights.forEach(light=>this.scene.add(light));
    this.activeDrawables=0;
    for(const {source,proxy}of this.bindings)if(proxy.visible){
      proxy.geometry=this.renderGeometry(source.geometry);this.scene.add(proxy);this.activeDrawables++;
    }
    for(const batch of this.batches)if(batch.proxy.visible){this.scene.add(batch.proxy);this.activeDrawables++;}
    this.bindingsDirty=false;this.syncCount++;
  }

  render(renderer:THREE.WebGLRenderer,camera:THREE.Camera):void{
    this.scene.background=this.sourceScene.background;
    this.scene.environment=this.sourceScene.environment;this.scene.environmentIntensity=this.sourceScene.environmentIntensity;
    this.scene.environmentRotation.copy(this.sourceScene.environmentRotation);this.scene.fog=this.sourceScene.fog;
    if(this.bindingsDirty)this.syncBindings();
    renderer.render(this.scene,camera);
  }

  diagnostics(){return {sourceDrawables:this.bindings.length,activeDrawables:this.activeDrawables,bindingSyncs:this.syncCount,rigidBatches:this.batches.length,batchedParts:this.batches.reduce((n,b)=>n+b.members.length,0),geometryPolicy:'all triangles retained; source hierarchy unchanged'};}
  dispose(){this.scene.clear();this.geometries.forEach(g=>g.dispose());}
}
