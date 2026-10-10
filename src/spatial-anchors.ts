import * as THREE from 'three';

export type AnchorBinding={rootId:string;modelVersion:string;objectId:string;instanceId?:number};
type AnchorRoot={id:string;version:string;root:THREE.Object3D};

export class AnchorRegistry{
  private meshes=new Map<string,THREE.Mesh>();
  private bindings=new WeakMap<THREE.Mesh,AnchorBinding>();
  constructor(roots:AnchorRoot[]){
    for(const {id,version,root}of roots){
      const walk=(node:THREE.Object3D,path:string)=>{
        if((node as THREE.Mesh).isMesh){
          const binding={rootId:id,modelVersion:version,objectId:path};
          this.meshes.set(`${id}/${path}`,node as THREE.Mesh);this.bindings.set(node as THREE.Mesh,binding);
        }
        const duplicates=new Map<string,number>();
        for(const child of node.children){
          const name=encodeURIComponent(child.name||child.type),ordinal=duplicates.get(name)??0;duplicates.set(name,ordinal+1);
          walk(child,`${path}/${name}[${ordinal}]`);
        }
      };
      walk(root,'');
    }
  }
  bind(mesh:THREE.Mesh,instanceId?:number):AnchorBinding|null{
    const binding=this.bindings.get(mesh);return binding?{...binding,...(instanceId===undefined?{}:{instanceId})}:null;
  }
  resolve(binding:AnchorBinding):THREE.Mesh|null{
    const mesh=this.meshes.get(`${binding.rootId}/${binding.objectId}`);
    if(!mesh||this.bindings.get(mesh)?.modelVersion!==binding.modelVersion)return null;
    if(binding.instanceId!==undefined&&(!(mesh as THREE.InstancedMesh).isInstancedMesh||!Number.isInteger(binding.instanceId)||binding.instanceId<0||binding.instanceId>=(mesh as THREE.InstancedMesh).count))return null;
    return mesh;
  }
}

export function finiteVector(value:unknown):value is [number,number,number]{
  return Array.isArray(value)&&value.length===3&&value.every(n=>typeof n==='number'&&Number.isFinite(n));
}

export function validBinding(value:unknown):value is AnchorBinding{
  if(!value||typeof value!=='object')return false;
  const b=value as AnchorBinding;
  return typeof b.rootId==='string'&&typeof b.modelVersion==='string'&&typeof b.objectId==='string'
    &&(b.instanceId===undefined||(Number.isInteger(b.instanceId)&&b.instanceId>=0));
}

export function anchorWorldPoint(mesh:THREE.Mesh,localPosition:[number,number,number],binding?:AnchorBinding):THREE.Vector3{
  return new THREE.Vector3(...localPosition).applyMatrix4(pointWorldMatrix(mesh,binding?.instanceId));
}

/** 标牌使用装配参考姿态；只移除登记的自转，保留装配位移及原始仿射矩阵。 */
export function stationaryAnchorWorldPoint(mesh:THREE.Mesh,localPosition:[number,number,number],restTransforms:ReadonlyMap<THREE.Object3D,THREE.Matrix4>,binding?:AnchorBinding):THREE.Vector3{
  mesh.updateWorldMatrix(true,false);
  const ancestors:THREE.Object3D[]=[];
  for(let node:THREE.Object3D|null=mesh;node;node=node.parent)ancestors.push(node);
  const matrix=new THREE.Matrix4();
  for(let i=ancestors.length-1;i>=0;i--){const node=ancestors[i];matrix.multiply(restTransforms.get(node)??node.matrix);}
  if(binding?.instanceId!==undefined&&(mesh as THREE.InstancedMesh).isInstancedMesh){
    const instance=new THREE.Matrix4();(mesh as THREE.InstancedMesh).getMatrixAt(binding.instanceId,instance);matrix.multiply(instance);
  }
  return new THREE.Vector3(...localPosition).applyMatrix4(matrix);
}

export function pointWorldMatrix(mesh:THREE.Mesh,instanceId?:number):THREE.Matrix4{
  mesh.updateWorldMatrix(true,false);
  const matrix=mesh.matrixWorld.clone();
  if(instanceId!==undefined&&(mesh as THREE.InstancedMesh).isInstancedMesh){
    const instance=new THREE.Matrix4();(mesh as THREE.InstancedMesh).getMatrixAt(instanceId,instance);matrix.multiply(instance);
  }
  return matrix;
}
