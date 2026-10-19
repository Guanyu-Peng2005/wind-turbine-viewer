import * as THREE from 'three';
import type { SurfacePoint } from './precision-selection';

/** The snapshot already includes the source instance transform. Never apply it twice. */
export function disassembledAnchor(position: readonly number[], snapshot: THREE.Matrix4, layout: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3(position[0],position[1],position[2]).applyMatrix4(snapshot).applyMatrix4(layout);
}

/** Convert a displayed batch hit back to the original CAD surface, not the batch instance id. */
export function captureDisassemblySurface(hit: THREE.Intersection, source: {mesh:THREE.Mesh;instanceId?:number}, snapshot: THREE.Matrix4, layout: THREE.Matrix4, geometry: THREE.BufferGeometry): SurfacePoint | null {
  const matrix=new THREE.Matrix4().multiplyMatrices(layout,snapshot);
  if(Math.abs(matrix.determinant())<1e-15||!hit.face)return null;
  return {...source,geometry,localPosition:hit.point.clone().applyMatrix4(matrix.invert()),localNormal:hit.face.normal.clone().normalize()};
}
