import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// InstancedMesh delegates to a temporary Mesh, so use the documented prototype
// hook. Meshes without a tree retain the standard Three.js raycast fallback.
THREE.Mesh.prototype.raycast=acceleratedRaycast;

export function worldVisible(object:THREE.Object3D):boolean{
  for(let n:THREE.Object3D|null=object;n;n=n.parent)if(!n.visible)return false;
  return true;
}

export class SpatialIndex{
  private worker:Worker|null=null;
  private pending=new WeakMap<THREE.BufferGeometry,Promise<boolean>>();
  private queue:Array<{geometry:THREE.BufferGeometry;resolve:(ready:boolean)=>void}>=[];
  private running=false;
  private built=0;
  private failed=0;

  ensure(geometry:THREE.BufferGeometry):Promise<boolean>{
    if(geometry.boundsTree)return Promise.resolve(true);
    const previous=this.pending.get(geometry);if(previous)return previous;
    const promise=new Promise<boolean>(resolve=>{this.queue.push({geometry,resolve});});
    this.pending.set(geometry,promise);void this.pump();return promise;
  }

  warm(meshes:THREE.Mesh[]):void{
    const geometries=[...new Set(meshes.map(m=>m.geometry))]
      .filter(g=>(g.index?.count??g.attributes.position.count)>=768)
      .sort((a,b)=>(b.index?.count??b.attributes.position.count)-(a.index?.count??a.attributes.position.count));
    geometries.forEach(g=>void this.ensure(g));
  }

  private async pump():Promise<void>{
    if(this.running)return;this.running=true;
    while(this.queue.length){
      const {geometry,resolve}=this.queue.shift()!;
      try{
        this.worker??=new Worker(new URL('./spatial-bvh.worker.ts',import.meta.url),{type:'module'});
        // Transfer copies only: source CAD buffers stay usable by rendering,
        // raycasting and LOD throughout the worker build.
        const attribute=geometry.attributes.position,position=new Float32Array(attribute.count*3);
        for(let i=0;i<attribute.count;i++){position[i*3]=attribute.getX(i);position[i*3+1]=attribute.getY(i);position[i*3+2]=attribute.getZ(i);}
        const index=geometry.index?new Uint32Array(geometry.index.array):null;
        await new Promise<void>((done,reject)=>{
          const worker=this.worker!;
          worker.onmessage=({data})=>{
            if(data.error){reject(new Error(data.error));return;}
            try{geometry.boundsTree=MeshBVH.deserialize(data.serialized,geometry,{setIndex:false});done();}catch(error){reject(error);}
          };
          worker.onerror=event=>{event.preventDefault();worker.terminate();this.worker=null;reject(new Error(event.message));};
          worker.postMessage({position,index,groups:geometry.groups},index?[position.buffer,index.buffer]:[position.buffer]);
        });
        this.built++;resolve(true);
      }catch(error){this.failed++;console.warn('Spatial acceleration unavailable; using exact mesh queries.',error);resolve(false);}
      // Yield between uploads so a queue of small geometries cannot monopolize UI work.
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    this.running=false;
  }

  diagnostics(){return {built:this.built,failed:this.failed,pending:this.queue.length+(this.running?1:0)};}
}

/** Returns a point on the actual mesh, preserving all original CAD indices. */
export function surfaceAnchor(mesh:THREE.Mesh,seed:THREE.Vector3,geometry=mesh.geometry):{position:THREE.Vector3;normal:THREE.Vector3}{
  const tree=geometry.boundsTree,hit=tree instanceof MeshBVH?tree.closestPointToPoint(seed):null;
  const triangle=new THREE.Triangle(),position=geometry.attributes.position,index=geometry.index;
  const read=(face:number)=>{
    const i=face*3;
    triangle.a.fromBufferAttribute(position,index?index.getX(i):i);
    triangle.b.fromBufferAttribute(position,index?index.getX(i+1):i+1);
    triangle.c.fromBufferAttribute(position,index?index.getX(i+2):i+2);
  };
  if(hit&&Number.isFinite(hit.distance)){read(hit.faceIndex);return {position:hit.point.clone(),normal:triangle.getNormal(new THREE.Vector3())};}
  let distance=Infinity;const closest=new THREE.Vector3(),point=new THREE.Vector3(),normal=new THREE.Vector3(0,1,0);
  for(let face=0;face<(index?.count??position.count)/3;face++){
    read(face);triangle.closestPointToPoint(seed,point);const d=point.distanceToSquared(seed);
    if(Number.isFinite(d)&&d<distance){distance=d;closest.copy(point);triangle.getNormal(normal);}
  }
  if(!Number.isFinite(distance))throw new Error('Mesh has no valid surface for an anchor');
  return {position:closest,normal};
}
