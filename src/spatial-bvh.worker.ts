import { BufferAttribute, BufferGeometry } from 'three';
import { MeshBVH, CENTER } from 'three-mesh-bvh';

self.onmessage=({data})=>{
  try{
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new BufferAttribute(data.position,3));
    if(data.index)geometry.setIndex(new BufferAttribute(data.index,1));
    geometry.groups=data.groups;
    const tree=new MeshBVH(geometry,{indirect:true,strategy:CENTER,targetLeafSize:12,verbose:false});
    const serialized=MeshBVH.serialize(tree,{cloneBuffers:false});
    const transfer:Transferable[]=[...serialized.roots];
    if(serialized.index)transfer.push(serialized.index.buffer as ArrayBuffer);
    if(serialized.indirectBuffer)transfer.push(serialized.indirectBuffer.buffer as ArrayBuffer);
    self.postMessage({serialized},{transfer});
  }catch(error){self.postMessage({error:String(error)});}
};
