import * as THREE from 'three';
import { pointWorldMatrix } from './spatial-anchors.ts';

export type SurfacePoint = {
  mesh: THREE.Mesh;
  instanceId?: number;
  geometry: THREE.BufferGeometry;
  localPosition: THREE.Vector3;
  localNormal: THREE.Vector3;
};

/** Capture the full-resolution hit before selection styling or motion changes.
 * Instance transforms are part of the inverse, so identical bolts stay distinct. */
export function captureSurfacePoint(hit: THREE.Intersection): SurfacePoint | null {
  const mesh=hit.object as THREE.Mesh;
  if(!mesh.isMesh||!hit.point.toArray().every(Number.isFinite))return null;
  const matrix=pointWorldMatrix(mesh,hit.instanceId);
  if(Math.abs(matrix.determinant())<1e-15)return null;
  return {mesh,instanceId:hit.instanceId,geometry:mesh.geometry,
    localPosition:hit.point.clone().applyMatrix4(matrix.invert()),
    localNormal:hit.face?.normal.clone().normalize()??new THREE.Vector3(0,1,0)};
}

export function surfaceWorldPoint(point: SurfacePoint): THREE.Vector3 {
  return point.localPosition.clone().applyMatrix4(pointWorldMatrix(point.mesh,point.instanceId));
}

export function surfaceWorldBounds(point: SurfacePoint): THREE.Box3 {
  if(!point.geometry.boundingBox)point.geometry.computeBoundingBox();
  return point.geometry.boundingBox!.clone().applyMatrix4(pointWorldMatrix(point.mesh,point.instanceId));
}

/** Immediate single selection, one double action, and no delayed stale callbacks.
 * The second tap returns the FIRST surface, even if styling/motion changes the ray. */
export class SurfaceTapSequence<T> {
  private last: {x:number;y:number;time:number;pointer:string;value:T}|null=null;
  clear():void{this.last=null;}
  tap(x:number,y:number,time:number,pointer:string,value:T): {double:boolean;value:T} {
    const previous=this.last;
    if(previous&&pointer===previous.pointer&&time>=previous.time&&time-previous.time<=500&&Math.hypot(x-previous.x,y-previous.y)<=8){
      this.last=null;return {double:true,value:previous.value};
    }
    this.last={x,y,time,pointer,value};return {double:false,value};
  }
}

export type PrecisionFocusPlan={center:THREE.Vector3;position:THREE.Vector3;bounds:THREE.Box3;distance:number;local:boolean};

/** Fit a small component, or a bounded region around the actual hit on a large
 * component. Repeated double clicks zoom inward instead of framing a whole blade. */
export function precisionFocusPlan(options:{bounds:THREE.Box3;point:THREE.Vector3;camera:THREE.PerspectiveCamera;
  direction:THREE.Vector3;frame:{width:number;height:number};viewportHeight:number;referenceSpan:number;forceLocal?:boolean}):PrecisionFocusPlan {
  const {camera,point,frame,viewportHeight}=options;
  const span=Math.max(options.referenceSpan,1e-3),minimum=span*1e-5;
  const direction=options.direction.clone().normalize();
  const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize();
  const up=new THREE.Vector3().crossVectors(direction,right).normalize();
  const tan=Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV())/2);
  const tx=Math.max(tan*frame.width/viewportHeight,1e-6),ty=Math.max(tan*frame.height/viewportHeight,1e-6);
  const distanceToPoint=Math.max(camera.position.distanceTo(point),minimum*10);
  const fit=(bounds:THREE.Box3,center:THREE.Vector3)=>{
    let distance=minimum;
    for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]){
      const offset=new THREE.Vector3(x,y,z).sub(center);
      distance=Math.max(distance,offset.dot(direction)+1.35*Math.max(Math.abs(offset.dot(right))/tx,Math.abs(offset.dot(up))/ty));
    }
    return distance;
  };
  let bounds=options.bounds.clone();if(bounds.isEmpty())bounds.setFromCenterAndSize(point,new THREE.Vector3(minimum,minimum,minimum));
  let center=bounds.getCenter(new THREE.Vector3()),distance=fit(bounds,center);
  const size=bounds.getSize(new THREE.Vector3()),longest=Math.max(size.x,size.y,size.z);
  const local=!!options.forceLocal||longest>span*.35||distance>distanceToPoint*.85;
  if(local){
    const region=Math.max(minimum,Math.min(span*.12,distanceToPoint*2*Math.min(tx,ty)*.3,Math.max(longest*.6,minimum)));
    center=point.clone();bounds.setFromCenterAndSize(center,new THREE.Vector3(region,region,region));distance=fit(bounds,center);
  }
  return {center,position:center.clone().addScaledVector(direction,distance),bounds,distance,local};
}
