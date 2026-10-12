import * as THREE from 'three';

/** 当前源文件的三种完整制动器表示高度重叠；不把替代表示当作内部零件。 */
export function brakeDisplayVariants(nodes:THREE.Object3D[]):{canonical:THREE.Object3D|null;hidden:Set<THREE.Object3D>}{
  const canonical=nodes.find(node=>node.name.includes('10010011498#高速轴制动器'))??null;
  const hidden=new Set<THREE.Object3D>();if(!canonical)return {canonical,hidden};
  const box=new THREE.Box3().setFromObject(canonical),size=box.getSize(new THREE.Vector3()),volume=size.x*size.y*size.z;
  for(const node of nodes){
    if(node===canonical||node.parent!==canonical.parent||!/10010011(?:607|499)#高速轴制动器/.test(node.name))continue;
    const candidate=new THREE.Box3().setFromObject(node),s=candidate.getSize(new THREE.Vector3()),v=s.x*s.y*s.z;
    const overlap=box.clone().intersect(candidate).getSize(new THREE.Vector3());
    if(Math.min(v,volume)>1e-12&&overlap.x*overlap.y*overlap.z/Math.min(v,volume)>.85)hidden.add(node);
  }
  return {canonical,hidden};
}
